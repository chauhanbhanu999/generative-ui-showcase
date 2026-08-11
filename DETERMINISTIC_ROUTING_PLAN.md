# Deterministic Tool Routing Plan

## Problem

The current architecture asks the LLM to do two things at once via the system prompt:

1. **Intent extraction** — what does the user want?
2. **Tool routing** — which tool satisfies that intent?

This makes the system probabilistic and hard to debug. Every failure is a black box.

---

## What Doesn't Solve It

| Approach | Why it falls short |
|---|---|
| Tighter tool schemas | Helps argument *filling*, not tool *selection* — still probabilistic |
| RAG tool retrieval (Pinecone) | Adds a second probabilistic hop before the LLM; only makes sense at 50–500+ tools |
| Better system prompt | Prototype-quality shortcut, not an architecture |

---

## The Solution: Structured Output + Graph Routing + `interrupt()`

Separate the two responsibilities so the LLM only handles language and code handles routing.

```
User message
    ↓
LLM (structured output only)
    → { intent: "chart" | "flight" | "greeting" | "general", params: { name?: str, ... } }
    ↓
Graph routes deterministically on intent type  ← pure Python, no LLM
    ↓
Pydantic validates params — are required fields present?
    ├── Yes → execute tool
    └── No  → LangGraph interrupt() → emit clarifying question → resume on user reply
```

Every step is inspectable and unit-testable.

---

## Step-by-Step Design

### Step 1 — Structured Intent Extraction

Replace the free-form system prompt with a single structured output call.

The LLM's only job is to map user text to a typed Pydantic object:

```python
from pydantic import BaseModel
from typing import Literal

class UserIntent(BaseModel):
    intent: Literal["chart", "flight", "greeting", "general"]
    name: str | None = None          # for greeting
    flight_query: str | None = None  # for flight
    chart_query: str | None = None   # for chart
    general_query: str | None = None # for general

intent_llm = llm.with_structured_output(UserIntent)
```

The LLM can fail to extract intent (handled as "general") but it cannot hallucinate a tool call.

---

### Step 2 — Deterministic Graph Routing

The graph routes on the extracted `intent` field — pure Python conditionals, no LLM judgment.

```
START
  ↓
intent_node (LLM extracts UserIntent)
  ↓
router (conditional edge on intent field)
  ├── "chart"    → chart_node
  ├── "flight"   → flight_node
  ├── "greeting" → greeting_node
  └── "general"  → general_llm_node
```

Each branch is a separate, testable node. A failure in the chart path does not affect the greeting path.

---

### Step 3 — Hard Gate on Missing Parameters via `interrupt()`

Before executing any tool, the graph checks required parameters in code.

```python
from langgraph.types import interrupt

def greeting_node(state):
    name = state["intent"].name
    if not name:
        # Hard gate — LLM is not involved in this decision
        name = interrupt("What's your name?")
    return call_tool(showMyName, name=name)
```

`interrupt()` pauses the graph, persists state to a checkpoint, and returns the question to the user. When the user replies, the graph resumes from exactly where it stopped. This is a code-level guarantee, not a prompt instruction.

---

### Step 4 — Tool Execution

Each branch node calls its tool directly — no LLM tool-selection step.

- `chart_node`: calls `query_data` unconditionally, then formats + calls `pieChart`
- `flight_node`: fills `flightCard` args from `intent.flight_query`; interrupts if missing fields
- `greeting_node`: calls `showMyName`; interrupts if `name` is None
- `general_llm_node`: falls back to free-form LLM response (no tools)

---

## What This Buys

| Property | Before (system prompt) | After (structured output + graph) |
|---|---|---|
| Tool selection | Probabilistic | Deterministic |
| Missing param handling | LLM decides (unreliable) | Hard gate in code |
| Debuggability | Black box | Inspect `UserIntent` object at every step |
| Testability | Requires LLM in the loop | Each node unit-testable with mock state |
| Failure mode | Silent wrong tool call | Explicit validation error or interrupt |

---

## Implementation Order

1. Define `UserIntent` Pydantic schema covering all tool intents
2. Build `intent_node` using `llm.with_structured_output(UserIntent)`
3. Replace `route_by_intent` keyword matching with router on `state["intent"].intent`
4. Build one branch node per intent, starting with `greeting_node` (simplest interrupt case)
5. Add `interrupt()` gates for required missing params in each branch
6. Remove the system prompt — it is no longer needed

---

## Notes

- The system prompt can be reduced to a single sentence describing the assistant's persona, not routing logic
- LangGraph's checkpointing must be enabled for `interrupt()` to persist state across user turns (requires a `MemorySaver` or persistent store)
- Structured output adds one extra LLM call per turn but eliminates the entire class of wrong-tool-selection errors
