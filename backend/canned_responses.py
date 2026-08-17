from __future__ import annotations

import re
from typing import TypedDict

from .agent_graph import build_funding_table_data, match_show_command_metric_key
from .data_store import load_json

# Pre-baked question/answer pairs (see /ask menu items in the frontend). Kept outside
# the LangGraph graph entirely: matching one of these means the "LLM call" for this
# turn is mocked by a JSON lookup rather than an actual classify/extract round-trip.
PROMPT_RESPONSES: list[dict[str, str]] = load_json("prompt-responses.json")


def _normalize(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


_QUESTION_LOOKUP: dict[str, str] = {_normalize(item["question"]): item["answer"] for item in PROMPT_RESPONSES}


class CannedUiResponse(TypedDict):
    kind: str  # "ui"
    component: str
    props: dict


class CannedMessageResponse(TypedDict):
    kind: str  # "message"
    content: str


def match_canned_response(message: str) -> CannedUiResponse | CannedMessageResponse | None:
    """First-pass check run before the graph: does this message already have a
    precomputed answer sitting in data/*.json? If so, return it directly so the
    turn never has to reach classify_intent.
    """
    metric_key = match_show_command_metric_key(message)
    if metric_key is not None:
        return {
            "kind": "ui",
            "component": "funding-table",
            "props": build_funding_table_data([metric_key]),
        }

    answer = _QUESTION_LOOKUP.get(_normalize(message))
    if answer is not None:
        return {"kind": "message", "content": answer}

    return None
