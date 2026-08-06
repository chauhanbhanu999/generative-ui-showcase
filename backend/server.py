from __future__ import annotations

import os
import sys
import warnings
from typing import Any, AsyncGenerator

from dotenv import load_dotenv, find_dotenv

warnings.filterwarnings("ignore")
load_dotenv(find_dotenv())  # load .env before any API clients are constructed

import fastapi
import fastapi.middleware.cors
import fastapi.responses
import pydantic

import ai
import ai.ui.ai_sdk

from backend.todos import TODO_TOOLS, get_todos_state, set_todos_state

# ---------------------------------------------------------------------------
# Model / provider
# ---------------------------------------------------------------------------

provider = ai.get_provider(
    "openai",
    api_key=os.environ.get("OPENAI_API_KEY"),
)
MODEL = ai.Model(id="gpt-4.1", provider=provider)

chat_agent = ai.Agent(tools=TODO_TOOLS)

SYSTEM_PROMPT = (
    "You manage a shared todo list. "
    "Use manage_todos to add, edit, or remove todos. "
    "Use get_todos to check the current list before making changes. "
    "When asked to manage todos, call open_or_close_todos with open=true first. "
    "Keep responses concise — 1 to 2 sentences."
)

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = fastapi.FastAPI(title="todo-agent")

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
    """Main chat endpoint — streams Vercel AI Data Stream Protocol."""
    print(f"[chat] {len(request.messages)} messages", file=sys.stderr, flush=True)
    messages, approvals = ai.ui.ai_sdk.to_messages(request.messages)
    messages.insert(0, ai.system_message(SYSTEM_PROMPT))

    async def stream_response() -> AsyncGenerator[str, None]:
        try:
            async with chat_agent.run(MODEL, messages) as result:
                ai.ui.ai_sdk.apply_approvals(approvals)

                async def process() -> AsyncGenerator[ai.events.AgentEvent, None]:
                    async for event in result:
                        print(f"[stream] {type(event).__name__}", file=sys.stderr, flush=True)
                        if isinstance(event, ai.events.HookEvent) and event.hook.status == "pending":
                            ai.defer_hook(event.hook)
                        yield event

                async for chunk in ai.ui.ai_sdk.to_sse(process()):
                    yield chunk
        except Exception as e:
            import traceback
            traceback.print_exc(file=sys.stderr)
            yield f'3:"{str(e)}"\n'

    return fastapi.responses.StreamingResponse(
        stream_response(),
        headers=ai.ui.ai_sdk.UI_MESSAGE_STREAM_HEADERS,
    )


# ---------------------------------------------------------------------------
# State sync endpoints (frontend can push user-edited todos back)
# ---------------------------------------------------------------------------

class StateUpdate(pydantic.BaseModel):
    todos: list[dict[str, Any]]


@app.put("/state")
async def update_state(body: StateUpdate) -> dict:
    """Frontend pushes user-edited todos so the agent sees them on the next turn."""
    set_todos_state(body.todos)
    return {"ok": True}


@app.get("/state")
async def get_state() -> dict:
    return {"todos": get_todos_state()}


# ---------------------------------------------------------------------------
# Entry point (used by helper.py in the notebook)
# ---------------------------------------------------------------------------

def start_backend(port: int = 8006) -> None:
    from helper import start_server
    start_server(app, port=port)
