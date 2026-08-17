from __future__ import annotations

import sys
from typing import Annotated, Literal, TypedDict

import pydantic
from langchain_core.messages import AnyMessage, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.types import interrupt

from .data_store import load_json

Intent = Literal["case_dossier", "am_search", "funding_table", "download", "llm_context", "general"]


class GraphState(TypedDict, total=False):
    messages: Annotated[list[AnyMessage], add_messages]
    intent: Intent
    extracted_fields: dict
    missing_fields: list[str]
    suggested_questions: list[str]


# --- Deterministic config: this is the only place intent -> component is decided ---

COMPONENT_BY_INTENT: dict[str, str] = {
    "case_dossier": "case-dossier",
    "am_search": "am-search-results",
    "funding_table": "funding-table",
    "download": "download-button",
    # "llm_context" and "general" intentionally omitted: no UI component, plain chat answer.
}

REQUIRED_FIELDS: dict[str, set[str]] = {
    "case_dossier": set(),
    "am_search": set(),
    "funding_table": set(),
    "download": {"report_type"},
    "llm_context": {"action", "article_reference"},
    "general": set(),
}

PROMPT_FOR: dict[str, str] = {
    "report_type": "Which report would you like to download - the full report, the selective report, or the case narrative?",
    "action": "Would you like to add or remove it?",
    "article_reference": "Which article - party name and article number?",
}


def non_empty_fields(fields: dict) -> dict:
    """Drop None/"" values so check_required_fields' key-presence check stays accurate.

    extracted_fields is reset fresh by each extract_* node (not merged with the
    previous turn's value) since it's checkpointed per-thread: merging would let a
    field extracted on an earlier, unrelated request (e.g. report_type="narrative")
    stick around forever and silently override what the user asks for next.
    """
    return {key: value for key, value in fields.items() if value not in (None, "")}


def push_ui_message(component: str, props: dict) -> None:
    writer = get_stream_writer()
    writer({"type": "ui", "component": component, "props": props})


def push_text_message(content: str) -> None:
    writer = get_stream_writer()
    writer({"type": "message", "content": content})


# --- Mock case data (deterministic demo fixtures, mirroring the reference AML UI mockups) ---
# Loaded from data/*.json rather than inlined so fixtures can be edited without touching code.

CASE_DOSSIER_DATA = load_json("case-dossier.json")
AM_SEARCH_DATA = load_json("am-search.json")
REPORT_DOWNLOAD_INFO: dict[str, dict[str, str]] = load_json("report-downloads.json")

# Raw per-indicator stats (funding-analysis-ui-reference.html's `data` object) and the
# label each indicator key renders under in the "Metric Type" column.
TABULAR_DATA: dict[str, dict[str, dict[str, float]]] = load_json("tabular-data.json")
FUNDING_METRIC_LABELS: dict[str, str] = load_json("funding-metric-labels.json")

# Substrings matched against the user's message (lowercased) to route a specific
# "/ask" show-command ("Show Top Incoming Type", ...) to a single indicator instead
# of the full combined table. Checked in order; first match wins. Shared with
# canned_responses.py so the same commands can be recognized without an LLM call.
SHOW_COMMAND_METRIC_KEYS: list[tuple[str, str]] = [
    ("incoming type", "top_incoming_types"),
    ("outgoing type", "top_outgoing_types"),
    ("incoming counterpart", "top_funding_sources"),
    ("outgoing counterpart", "top_counterparties"),
]


def _last_human_text(state: GraphState) -> str:
    for message in reversed(state["messages"]):
        if isinstance(message, HumanMessage):
            return str(message.content)
    return ""


def match_show_command_metric_key(text: str) -> str | None:
    lowered = text.lower()
    for needle, metric_key in SHOW_COMMAND_METRIC_KEYS:
        if needle in lowered:
            return metric_key
    return None


def build_funding_table_data(metric_keys: list[str] | None = None) -> dict:
    keys = metric_keys if metric_keys is not None else list(FUNDING_METRIC_LABELS.keys())

    rows = []
    for key in keys:
        metric_type = FUNDING_METRIC_LABELS[key]
        entries = TABULAR_DATA.get(key, {})
        for name, stats in sorted(entries.items(), key=lambda kv: kv[1]["total"], reverse=True):
            rows.append(
                {
                    "metricType": metric_type,
                    "name": name,
                    "count": f"{stats['count']:,}",
                    "ratio": f"{stats['ratio'] * 100:.1f}%",
                    "max": f"${stats['max']:,.2f}",
                    "min": f"${stats['min']:,.2f}",
                    "total": f"${stats['total']:,.2f}",
                }
            )

    title = FUNDING_METRIC_LABELS[keys[0]] if len(keys) == 1 else "Funding Analysis"

    return {
        "title": title,
        "columns": [
            {"key": "metricType", "label": "Metric Type"},
            {"key": "name", "label": "Name"},
            {"key": "count", "label": "Count", "align": "right"},
            {"key": "ratio", "label": "Percentage", "align": "right"},
            {"key": "max", "label": "Maximum", "align": "right"},
            {"key": "min", "label": "Minimum", "align": "right"},
            {"key": "total", "label": "Total", "align": "right"},
        ],
        "rows": rows,
    }


# --- LLM setup ---

_MODEL_NAME = "gpt-4o-mini"

CLASSIFY_SYSTEM = (
    "Classify the user's latest message into exactly one intent:\n"
    "'case_dossier' - wants KYC/customer information, AML history, or case background for the case.\n"
    "'am_search' - wants to see adverse media search results for parties/counterparties.\n"
    "'funding_table' - wants a funding/transaction/counterparty analysis breakdown as a table.\n"
    "'download' - wants to download a report: the full AM search report, the selective AM search "
    "report, or the case narrative.\n"
    "'llm_context' - wants to add or remove a specific adverse-media article to/from the LLM context.\n"
    "'general' - anything else, including questions about the data or casual conversation."
)


class IntentResult(pydantic.BaseModel):
    intent: Intent


class DownloadFields(pydantic.BaseModel):
    report_type: Literal["full", "selective", "narrative"] | None = None


DOWNLOAD_EXTRACTION_SYSTEM = (
    "Extract which report the user wants to download: 'full' (the full AM search report), "
    "'selective' (the selective/selected AM search report), or 'narrative' (the case narrative). "
    "Leave `report_type` null if the user did not clearly specify one of these three - never guess."
)


class LlmContextFields(pydantic.BaseModel):
    action: Literal["add", "remove"] | None = None
    article_reference: str | None = None


LLM_CONTEXT_EXTRACTION_SYSTEM = (
    "Extract whether the user wants to 'add' or 'remove' an adverse-media article to/from the LLM "
    "context, and which article they mean (e.g. a party name and/or article number). Leave a field "
    "null if it isn't clearly stated - never guess or invent a value."
)


class Suggestions(pydantic.BaseModel):
    questions: list[str]


SUGGEST_SYSTEM = (
    "Suggest exactly 3 short, natural follow-up questions the user might ask next, "
    "given the current intent and known fields. Return only the questions."
)

classify_llm = ChatOpenAI(model=_MODEL_NAME).with_structured_output(IntentResult)
download_llm = ChatOpenAI(model=_MODEL_NAME).with_structured_output(DownloadFields)
llm_context_llm = ChatOpenAI(model=_MODEL_NAME).with_structured_output(LlmContextFields)
suggest_llm = ChatOpenAI(model=_MODEL_NAME).with_structured_output(Suggestions)
general_llm = ChatOpenAI(model=_MODEL_NAME, streaming=True)


# --- Nodes ---

async def classify_intent(state: GraphState) -> dict:
    result = await classify_llm.ainvoke([SystemMessage(content=CLASSIFY_SYSTEM), *state["messages"]])
    return {"intent": result.intent}


def route_by_intent(state: GraphState) -> str:
    return state["intent"]


def extract_case_dossier(state: GraphState) -> dict:
    # Nothing to extract - dossier data is fetched deterministically in render_component.
    return {}


def extract_am_search(state: GraphState) -> dict:
    return {}


def extract_funding_table(state: GraphState) -> dict:
    metric_key = match_show_command_metric_key(_last_human_text(state))
    return {"extracted_fields": non_empty_fields({"metric_key": metric_key})}


async def extract_download(state: GraphState) -> dict:
    result = await download_llm.ainvoke([SystemMessage(content=DOWNLOAD_EXTRACTION_SYSTEM), *state["messages"]])
    return {"extracted_fields": non_empty_fields(result.model_dump())}


async def extract_llm_context(state: GraphState) -> dict:
    result = await llm_context_llm.ainvoke([SystemMessage(content=LLM_CONTEXT_EXTRACTION_SYSTEM), *state["messages"]])
    return {"extracted_fields": non_empty_fields(result.model_dump())}


async def extract_general(state: GraphState) -> dict:
    response = await general_llm.ainvoke(state["messages"])
    return {"messages": [response]}


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

    if intent == "llm_context":
        fields = state.get("extracted_fields", {})
        action = fields.get("action", "update")
        article = fields.get("article_reference", "the article")
        verb = {"add": "added to", "remove": "removed from"}.get(action, "updated in")
        push_text_message(f"Done — {article} has been {verb} the LLM context.")
        return {}

    component = COMPONENT_BY_INTENT.get(intent)
    if component is None:
        return {}

    if intent == "case_dossier":
        props = CASE_DOSSIER_DATA
    elif intent == "am_search":
        props = AM_SEARCH_DATA
    elif intent == "funding_table":
        fields = state.get("extracted_fields", {})
        metric_key = fields.get("metric_key")
        props = build_funding_table_data([metric_key] if metric_key else None)
    elif intent == "download":
        fields = state.get("extracted_fields", {})
        report_type = fields.get("report_type", "full")
        props = REPORT_DOWNLOAD_INFO.get(report_type, REPORT_DOWNLOAD_INFO["full"])
    else:
        props = dict(state.get("extracted_fields", {}))

    push_ui_message(component, props)
    return {}


async def suggest_next_questions(state: GraphState) -> dict:
    if state.get("intent") == "am_search":
        return {"suggested_questions": ["Add a result to LLM context", "Remove a result from LLM context"]}
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
    graph.add_node("extract_case_dossier", extract_case_dossier)
    graph.add_node("extract_am_search", extract_am_search)
    graph.add_node("extract_funding_table", extract_funding_table)
    graph.add_node("extract_download", extract_download)
    graph.add_node("extract_llm_context", extract_llm_context)
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
            "case_dossier": "extract_case_dossier",
            "am_search": "extract_am_search",
            "funding_table": "extract_funding_table",
            "download": "extract_download",
            "llm_context": "extract_llm_context",
            "general": "extract_general",
        },
    )

    for node in (
        "extract_case_dossier",
        "extract_am_search",
        "extract_funding_table",
        "extract_download",
        "extract_llm_context",
        "extract_general",
    ):
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
