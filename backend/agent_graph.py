from __future__ import annotations

import sys
from typing import Annotated, Literal, TypedDict

import pydantic
from langchain_core.messages import AnyMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.types import interrupt

from .data import get_category_summary, query_data
from .weather import get_weather

Intent = Literal["chart", "flight", "greeting", "weather", "general"]


class GraphState(TypedDict, total=False):
    messages: Annotated[list[AnyMessage], add_messages]
    intent: Intent
    extracted_fields: dict
    missing_fields: list[str]
    suggested_questions: list[str]


# --- Deterministic config: this is the only place intent -> component is decided ---

COMPONENT_BY_INTENT: dict[str, str] = {
    "greeting": "name-greeting",
    "flight": "flight-card",
    "chart": "pie-chart",
    "weather": "weather-card",
    # "general" intentionally omitted: no UI component, plain chat answer.
}

REQUIRED_FIELDS: dict[str, set[str]] = {
    "greeting": {"name"},
    "flight": {"origin", "destination", "airline", "departure_time", "price"},
    "chart": set(),
    "weather": {"location"},
    "general": set(),
}

PROMPT_FOR: dict[str, str] = {
    "name": "What's your name?",
    "origin": "Where are you flying from?",
    "destination": "Where are you flying to?",
    "airline": "Which airline would you like to fly?",
    "departure_time": "What departure time works for you?",
    "price": "What's your budget for the ticket?",
    "location": "Which city would you like the weather for?",
}


def merge_fields(existing: dict, new: dict) -> dict:
    """Merge extracted fields without ever overwriting an already-known value."""
    merged = dict(existing)
    for key, value in new.items():
        if key not in merged and value not in (None, ""):
            merged[key] = value
    return merged


def push_ui_message(component: str, props: dict) -> None:
    writer = get_stream_writer()
    writer({"type": "ui", "component": component, "props": props})


# --- LLM setup ---

_MODEL_NAME = "gpt-4o-mini"

CLASSIFY_SYSTEM = (
    "Classify the user's latest message into exactly one intent:\n"
    "'chart' - wants to see spending broken down by category as a chart.\n"
    "'flight' - wants to book or see a flight summary.\n"
    "'greeting' - is introducing themselves or asking to be greeted by name.\n"
    "'general' - anything else, including questions about the data or casual conversation."
)


class IntentResult(pydantic.BaseModel):
    intent: Intent


class GreetingFields(pydantic.BaseModel):
    name: str | None = None


GREETING_EXTRACTION_SYSTEM = (
    "Extract the user's name from the conversation. "
    "Leave `name` null if the user did not explicitly state their own name - "
    "never guess, invent, or fall back to a placeholder like 'User' or 'your name'."
)


class FlightFields(pydantic.BaseModel):
    origin: str | None = None
    destination: str | None = None
    airline: str | None = None
    departure_time: str | None = None
    price: str | None = None


FLIGHT_EXTRACTION_SYSTEM = (
    "Extract the flight origin, destination, airline, departure_time, and price "
    "from the conversation. Leave a field null if the user did not explicitly "
    "state it - never guess, infer, or invent a value for any of these fields."
)


class Suggestions(pydantic.BaseModel):
    questions: list[str]


SUGGEST_SYSTEM = (
    "Suggest exactly 3 short, natural follow-up questions the user might ask next, "
    "given the current intent and known fields. Return only the questions."
)

classify_llm = ChatOpenAI(model=_MODEL_NAME).with_structured_output(IntentResult)
greeting_llm = ChatOpenAI(model=_MODEL_NAME).with_structured_output(GreetingFields)
flight_llm = ChatOpenAI(model=_MODEL_NAME).with_structured_output(FlightFields)
suggest_llm = ChatOpenAI(model=_MODEL_NAME).with_structured_output(Suggestions)
general_llm = ChatOpenAI(model=_MODEL_NAME, streaming=True)
general_llm_with_tools = general_llm.bind_tools([query_data])


# --- Nodes ---

async def classify_intent(state: GraphState) -> dict:
    result = await classify_llm.ainvoke([SystemMessage(content=CLASSIFY_SYSTEM), *state["messages"]])
    return {"intent": result.intent}


def route_by_intent(state: GraphState) -> str:
    return state["intent"]


async def extract_greeting(state: GraphState) -> dict:
    result = await greeting_llm.ainvoke([SystemMessage(content=GREETING_EXTRACTION_SYSTEM), *state["messages"]])
    merged = merge_fields(state.get("extracted_fields", {}), result.model_dump())
    return {"extracted_fields": merged}


async def extract_flight(state: GraphState) -> dict:
    result = await flight_llm.ainvoke([SystemMessage(content=FLIGHT_EXTRACTION_SYSTEM), *state["messages"]])
    merged = merge_fields(state.get("extracted_fields", {}), result.model_dump())
    return {"extracted_fields": merged}


def extract_chart(state: GraphState) -> dict:
    # Nothing to extract - chart data is fetched deterministically in render_component.
    return {}


async def extract_general(state: GraphState) -> dict:
    response = await general_llm_with_tools.ainvoke(state["messages"])
    if not response.tool_calls:
        return {"messages": [response]}

    tool_messages = []
    for call in response.tool_calls:
        if call["name"] == "query_data":
            result = await query_data.ainvoke(call["args"])
        else:
            result = f"Unknown tool: {call['name']}"
        tool_messages.append(ToolMessage(content=str(result), tool_call_id=call["id"]))

    follow_up = await general_llm.ainvoke([*state["messages"], response, *tool_messages])
    return {"messages": [response, *tool_messages, follow_up]}


def check_required_fields(state: GraphState) -> dict:
    required = REQUIRED_FIELDS.get(state["intent"], set())
    extracted = state.get("extracted_fields", {})
    missing = sorted(required - extracted.keys())
    return {"missing_fields": missing}


def route_after_check(state: GraphState) -> str:
    return "ask_for_missing_fields" if state.get("missing_fields") else "render_component"


def ask_for_missing_fields(state: GraphState) -> dict:
    missing = state["missing_fields"]
    answers = interrupt({
        "type": "missing_fields",
        "fields": [{"field": f, "prompt": PROMPT_FOR[f]} for f in missing],
    })
    merged = dict(state.get("extracted_fields", {}))
    if isinstance(answers, dict):
        for field in missing:
            value = answers.get(field)
            if value:
                merged[field] = value
    return {"extracted_fields": merged}


def render_component(state: GraphState) -> dict:
    intent = state["intent"]
    component = COMPONENT_BY_INTENT.get(intent)
    if component is None:
        return {}

    if intent == "chart":
        props = {
            "title": "Spending by Category",
            "description": "Breakdown of spending across subcategories",
            "data": get_category_summary(),
        }
    elif intent == "flight":
        fields = state.get("extracted_fields", {})
        # `title` is purely decorative (a header label), so it's the one flight-card
        # field derived deterministically rather than gated as a required field.
        props = {**fields, "title": f"{fields.get('origin')} to {fields.get('destination')}"}
    else:
        props = dict(state.get("extracted_fields", {}))

    push_ui_message(component, props)
    return {}


async def suggest_next_questions(state: GraphState) -> dict:
    try:
        result = await suggest_llm.ainvoke([
            SystemMessage(content=SUGGEST_SYSTEM),
            HumanMessage(content=f"intent: {state.get('intent')}\nfields: {state.get('extracted_fields', {})}"),
        ])
        return {"suggested_questions": result.questions[:3]}
    except Exception as e:
        print(f"[suggest_next_questions] failed, returning no suggestions: {e}", file=sys.stderr, flush=True)
        return {"suggested_questions": []}


# --- Graph assembly ---

def build_graph(checkpointer: BaseCheckpointSaver):
    graph = StateGraph(GraphState)

    graph.add_node("classify_intent", classify_intent)
    graph.add_node("extract_chart", extract_chart)
    graph.add_node("extract_flight", extract_flight)
    graph.add_node("extract_greeting", extract_greeting)
    graph.add_node("extract_general", extract_general)
    graph.add_node("check_required_fields", check_required_fields)
    graph.add_node("ask_for_missing_fields", ask_for_missing_fields)
    graph.add_node("render_component", render_component)
    graph.add_node("suggest_next_questions", suggest_next_questions)

    graph.add_edge(START, "classify_intent")
    graph.add_conditional_edges(
        "classify_intent",
        route_by_intent,
        {
            "chart": "extract_chart",
            "flight": "extract_flight",
            "greeting": "extract_greeting",
            "general": "extract_general",
        },
    )

    for node in ("extract_chart", "extract_flight", "extract_greeting", "extract_general"):
        graph.add_edge(node, "check_required_fields")

    graph.add_conditional_edges(
        "check_required_fields",
        route_after_check,
        {
            "ask_for_missing_fields": "ask_for_missing_fields",
            "render_component": "render_component",
        },
    )
    graph.add_edge("ask_for_missing_fields", "check_required_fields")
    graph.add_edge("render_component", "suggest_next_questions")
    graph.add_edge("suggest_next_questions", END)

    return graph.compile(checkpointer=checkpointer)
