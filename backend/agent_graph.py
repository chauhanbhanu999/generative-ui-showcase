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

CASE_DOSSIER_DATA = {
    "caseId": "aml-user__testbh1151__1785945076350",
    "caseName": "testbh1151",
    "riskLevel": "High Risk",
    "kycInformation": {
        "confidence": "Confidence 0.92 · 4 sources",
        "fields": [
            {"label": "Customer Name", "value": "WANDA MEEKIS"},
            {"label": "Customer Type", "value": "Personal"},
            {"label": "Email Address", "value": "WANDAMEEKIS@ICLOUD.COM"},
            {"label": "Acq Date", "value": "August 2009"},
        ],
        "notes": [
            {
                "title": "Profile and Ownership",
                "status": "Watch",
                "text": (
                    "Wanda Meekis (DOB: February 10, 1980, Canada Certificate Of Indian Status: "
                    "2340060201) is 46 years old and employed at Wendigo Catering as a Caterer. "
                    "Wanda Meekis resides at 41 Seventh Ave Apt A, Sioux Lookout, On, P8T1H6, with "
                    "listed phone number as 1-807-738-3640 and email wandameekis@icloud.com. Wanda "
                    "Meekis has been a BMO client."
                ),
            },
            {
                "title": "Geography",
                "status": "Stable",
                "text": "Residence listed as Sioux Lookout, Ontario, Canada.",
            },
        ],
    },
    "amlHistory": {
        "confidence": "Confidence 0.88 · 6 sources",
        "cases": [
            {
                "caseId": "C2503224278",
                "type": "AML - Suspicious Activity",
                "status": "Reported/Closed",
                "recommendation": "Customer was previously recommended for demarketed under case C2503224278.",
            },
            {
                "caseId": "C2506235471",
                "type": "AML - Suspicious Activity",
                "status": "Reported/Closed",
                "recommendation": "Maintaining could pose future reputational and regulatory risk.",
            },
            {
                "caseId": "C2510257140",
                "type": "AML - Suspicious Activity",
                "status": "Reported/Closed",
                "recommendation": "Confirmed first-party deposit fraud resulting in demarketing by BMO in September 2025.",
            },
        ],
        "notes": [
            {
                "title": "Prior Alerts",
                "status": "Critical",
                "text": "Number of Cases: 3. Number of STRs: 3.",
            },
            {
                "title": "Previous Investigation Outcome",
                "status": "Watch",
                "text": (
                    "The client had 3 previous cases: C2503224278 where the client was reported in "
                    "July 2025 due to suspected drug trafficking based on 2010 adverse media, "
                    "transacting with individuals charged with fentanyl trafficking, and unusual cash "
                    "and EMT activity inconsistent with profile; C2506235471 where the client was "
                    "reported in August 2025 due to continued suspected drug trafficking with similar "
                    "pass-through patterns, connections to previously reported counterparties, and use "
                    "of disguised contact names; and C2510257140 where the client was reported in "
                    "November 2025 due to suspected drug trafficking, transacting with counterparties "
                    "linked to drug trafficking charges, and confirmed first-party deposit fraud "
                    "resulting in demarketing by BMO in September 2025."
                ),
            },
        ],
    },
    "caseBackground": {
        "confidence": "Confidence 0.90 · 3 sources",
        "summary": (
            "Wanda Meekis is a high-risk personal customer who was alerted for review due to "
            "concerning electronic money transfer activity. The alert was triggered by an AML "
            "machine learning model (CA_EMT_ML02_M_HR_P) that identified unusual patterns in EMT "
            "activity involving 29 counterparties across two accounts. The client was previously "
            "reviewed under case C2510257140 and flagged for potential drug trafficking. Historical "
            "cases C2503224278 and C2506235471 documented adverse media findings indicating the "
            "customer had ties to various counterparties with drug trafficking charges and may have "
            "faced such charges themselves. The client had previously been recommended for "
            "demarketing under case C2503224278, however, activity during the current review period "
            "suggested the past concerning behaviour may be continuing, warranting further "
            "investigation."
        ),
        "notes": [
            {
                "title": "Business Context",
                "status": "Watch",
                "text": (
                    "The fund depletion pattern is concerning. The dominance of EMT activity (46.5%) "
                    "concentrated to two individuals (46.4% of outbound funds), combined with "
                    "significant return items (11.5%) and third-party cash withdrawals (7.9%), "
                    "deviates substantially from normal personal banking patterns. The high proportion "
                    "of internal transfers preceding EMT depletion suggests potential pass-through "
                    "activity."
                ),
            },
            {
                "title": "Investigator Notes",
                "status": "Reviewed",
                "text": "Transaction velocity and counterparty concentration align with patterns documented in previous investigations.",
            },
        ],
    },
}

AM_SEARCH_DATA = {
    "caseName": "testbh1151",
    "caseSummary": (
        "This case involves multiple counterparties and related parties with varying levels of "
        "adverse media findings. Key concern themes include violent crime, sexual offenses, fraud, "
        "and drug trafficking across jurisdictions."
    ),
    "parties": [
        {
            "partyName": "GURWINDER SINGH",
            "role": "Counter Party",
            "articlesFound": 13,
            "searchQueryUsed": '"GURWINDER SINGH" adverse media criminal conviction',
            "adverseMediaSummary": (
                "Conviction records and arrest reports in UK, Canada, and India with sexual offense "
                "and narcotics-related allegations."
            ),
            "articles": [
                {
                    "indexInResults": 1,
                    "title": "Southwark Crown Court convicts Gurwinder Singh",
                    "source": "Court Bulletin",
                    "theme": "Sexual Offenses",
                    "url": "https://example.com/article-1",
                    "summary": "Subject convicted on multiple counts after hotel-lure investigation with potential additional victims.",
                },
                {
                    "indexInResults": 2,
                    "title": "Surrey police arrest related to Criminal Code offenses",
                    "source": "City News",
                    "theme": "Violence",
                    "url": "https://example.com/article-2",
                    "summary": "Arrest report following vehicle stop and public safety concerns.",
                },
            ],
        },
        {
            "partyName": "MANJOT SINGH",
            "role": "Counter Party",
            "articlesFound": 11,
            "searchQueryUsed": '"MANJOT SINGH" robbery arrest ICE detention',
            "adverseMediaSummary": "Multiple arrests in the US and links to organized crime allegations in India and Canada.",
            "articles": [
                {
                    "indexInResults": 1,
                    "title": "ICE detains Manjot Singh with prior arrests",
                    "source": "US Federal Update",
                    "theme": "Criminal History",
                    "url": "https://example.com/article-3",
                    "summary": "Detention report cites repeated arrests and deportation proceedings.",
                },
            ],
        },
        {
            "partyName": "2759746 ALBERTA INC.",
            "role": "Primary Owner",
            "articlesFound": 0,
            "searchQueryUsed": "",
            "adverseMediaSummary": "",
            "articles": [],
        },
    ],
}


def _build_funding_table_data() -> dict:
    groups: dict[str, dict[str, dict[str, float]]] = {
        "Top Incoming Type": {
            "PAYROLL": {"count": 22, "ratio": 0.144, "min": 450.0, "max": 6200.0, "total": 59810.2},
            "TRANSFER": {"count": 19, "ratio": 0.126, "min": 80.0, "max": 9400.88, "total": 48320.17},
            "DEPOSIT": {"count": 11, "ratio": 0.072, "min": 40.0, "max": 3600.0, "total": 15790.45},
        },
        "Top Outgoing Type": {
            "CHEQUE": {"count": 16, "ratio": 0.102, "min": 75.0, "max": 8700.0, "total": 41240.63},
            "INTERAC": {"count": 29, "ratio": 0.189, "min": 20.0, "max": 2500.0, "total": 22311.45},
            "WIRE": {"count": 7, "ratio": 0.044, "min": 450.0, "max": 12000.0, "total": 39820.0},
        },
        "Top Incoming Counterparty": {
            "EMT": {"count": 31, "ratio": 0.203, "min": 50.0, "max": 15000.0, "total": 109201.75},
            "WIRE": {"count": 12, "ratio": 0.079, "min": 350.0, "max": 22000.45, "total": 73450.9},
            "CASH": {"count": 8, "ratio": 0.051, "min": 100.0, "max": 5000.0, "total": 18800.0},
        },
        "Top Outgoing Counterparty": {
            "2506152 ONTARIO INC.": {"count": 18, "ratio": 0.112, "min": 45.12, "max": 9200.0, "total": 35512.28},
            "9528-1036 QUEBEC INC.": {"count": 14, "ratio": 0.091, "min": 75.0, "max": 7400.55, "total": 24990.67},
            "WAVE - RCCIC": {"count": 9, "ratio": 0.058, "min": 120.5, "max": 6800.0, "total": 15842.11},
        },
    }

    rows = []
    for metric_type, entries in groups.items():
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

    return {
        "title": "Funding Analysis",
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


FUNDING_TABLE_DATA = _build_funding_table_data()

REPORT_DOWNLOAD_INFO: dict[str, dict[str, str]] = {
    "full": {
        "label": "Full report",
        "url": "https://example.com/reports/testbh1151-full-am-search-report.pdf",
    },
    "selective": {
        "label": "Selective report",
        "url": "https://example.com/reports/testbh1151-selective-am-search-report.pdf",
    },
    "narrative": {
        "label": "case narrative",
        "url": "https://example.com/reports/testbh1151-case-narrative.pdf",
    },
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
    return {}


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
        props = FUNDING_TABLE_DATA
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
