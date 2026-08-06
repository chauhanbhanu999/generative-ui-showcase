from __future__ import annotations

import csv
import os
import sys
import warnings
from pathlib import Path
from typing import Any, AsyncGenerator

from dotenv import load_dotenv, find_dotenv

warnings.filterwarnings("ignore")
load_dotenv(find_dotenv())  # load .env before any API clients are constructed

import fastapi
import fastapi.middleware.cors
import fastapi.responses
import pydantic

# The new Vercel AI SDK for Python
import ai
import ai.ui.ai_sdk

_LESSON_ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = _LESSON_ROOT / "db.csv"

# --- Tools Definition ---

@ai.tool
async def query_data(query: str) -> list[dict[str, Any]]:
    """Query the raw dataset. Returns all CSV rows. Use get_category_summary instead if you need aggregated data for a chart."""
    with CSV_PATH.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        return list(reader)

@ai.tool
async def get_category_summary() -> list[dict[str, Any]]:
    """Get aggregated totals by subcategory from the dataset. Use this before showing a pie chart — it returns data already grouped as {label, value} pairs."""
    from collections import defaultdict
    totals: dict[str, float] = defaultdict(float)
    with CSV_PATH.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            totals[row["subcategory"]] += float(row["amount"])
    return [{"label": k, "value": v} for k, v in totals.items()]


# For Generative UI tools, we simply define them so the LLM knows they exist.
# We don't actually need to execute any logic on the backend; the UI renders them!

class PieChartData(pydantic.BaseModel):
    label: str
    value: float

@ai.tool
async def pieChart(title: str, description: str, data: list[PieChartData]) -> dict:
    """Displays data as a pie chart on the frontend. Use this for category distributions."""
    return {"title": title, "description": description, "data": [d.dict() for d in data]}

@ai.tool
async def flightCard(title: str, airline: str, origin: str, destination: str, departure_time: str, price: str) -> dict:
    """Displays a single flight summary card on the frontend."""
    return {
        "title": title, "airline": airline, "origin": origin,
        "destination": destination, "departure_time": departure_time, "price": price
    }

@ai.tool
async def showMyName(name: str) -> dict:
    """Displays a friendly greeting card for the given name on the frontend."""
    return {"name": name}



TOOLS: list[ai.AgentTool] = [query_data, pieChart, flightCard, showMyName]

# Use OpenAI native provider reading from .env
provider = ai.get_provider(
    "openai",
    api_key=os.environ.get("OPENAI_API_KEY"),
)
MODEL = ai.Model(id="gpt-4o-mini", provider=provider)

# provider = ai.get_provider(
#     "google",
#     api_key=os.environ.get("GEMINI_API_KEY"),
# )
# MODEL = ai.Model(id="gemini-3.6-flash", provider=provider)

chat_agent = ai.Agent(tools=TOOLS)
SYSTEM_PROMPT = (
    "You are a helpful AI assistant. "
    "When a user asks for charts based on the dataset, always call query_data first to fetch all CSV rows. "
    "Prefer using a matching frontend tool when it would present the answer clearly. "
    "Use pieChart for category distributions, "
    "flightCard for a single flight summary, "
    "and showMyName to greet a user by name. "
    "Tool arguments must match the provided schema exactly."
)

# --- FastAPI Application ---

app = fastapi.FastAPI(
    title="ai-data-explorer",
    description="Generative UI agent with data querying and chart rendering.",
)

app.add_middleware(
    fastapi.middleware.cors.CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(pydantic.BaseModel):
    messages: list[ai.ui.ai_sdk.UIMessage]


@app.post("/")
async def chat(request: ChatRequest) -> fastapi.responses.StreamingResponse:
    """Handle chat requests and stream responses in Vercel AI Data Stream Protocol."""
    print(f"[chat] Received {len(request.messages)} messages", file=sys.stderr, flush=True)
    messages, approvals = ai.ui.ai_sdk.to_messages(request.messages)

    # Prepend the system prompt to the messages list
    messages.insert(0, ai.system_message(SYSTEM_PROMPT))
    print(f"[chat] Converted to {len(messages)} ai messages, streaming...", file=sys.stderr, flush=True)

    async def stream_response() -> AsyncGenerator[str, None]:
        try:
            async with chat_agent.run(MODEL, messages) as result:
                ai.ui.ai_sdk.apply_approvals(approvals)

                async def process() -> AsyncGenerator[ai.events.AgentEvent, None]:
                    async for event in result:
                        print(f"[stream] event: {type(event).__name__}", file=sys.stderr, flush=True)
                        if isinstance(event, ai.events.HookEvent) and event.hook.status == "pending":
                            ai.defer_hook(event.hook)
                        yield event

                async for chunk in ai.ui.ai_sdk.to_sse(process()):
                    yield chunk
        except Exception as e:
            import traceback
            traceback.print_exc(file=sys.stderr)
            # Yield the error as a data stream error so the frontend sees it
            yield f'3:"{str(e)}"\n'

    return fastapi.responses.StreamingResponse(
        stream_response(),
        headers=ai.ui.ai_sdk.UI_MESSAGE_STREAM_HEADERS,
    )

