from __future__ import annotations

import json
import sys
import warnings
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncGenerator

from dotenv import load_dotenv, find_dotenv

warnings.filterwarnings("ignore")
load_dotenv(find_dotenv())  # load .env before any API clients are constructed

import fastapi
import fastapi.middleware.cors
import fastapi.responses
import pydantic
from langchain_core.messages import HumanMessage
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.types import Command

from .agent_graph import build_graph
from .canned_responses import match_canned_response

_REPO_ROOT = Path(__file__).resolve().parents[1]
CHECKPOINT_DB = _REPO_ROOT / "backend" / "checkpoints.db"


@asynccontextmanager
async def lifespan(app: fastapi.FastAPI):
    async with AsyncSqliteSaver.from_conn_string(str(CHECKPOINT_DB)) as checkpointer:
        app.state.graph = build_graph(checkpointer)
        yield


app = fastapi.FastAPI(
    title="genui-chat",
    description="Deterministic generative-UI agent built on LangGraph.",
    lifespan=lifespan,
)

app.add_middleware(
    fastapi.middleware.cors.CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(pydantic.BaseModel):
    thread_id: str
    message: str | None = None
    resume: dict[str, Any] | None = None


def sse_event(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _sse_response(event_stream: AsyncGenerator[str, None]) -> fastapi.responses.StreamingResponse:
    return fastapi.responses.StreamingResponse(
        event_stream,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/")
async def chat(request: ChatRequest) -> fastapi.responses.StreamingResponse:
    # First pass: if this exact question already has a precomputed answer in
    # data/*.json (an /ask show-command or a canned Q&A pair), serve it directly
    # and skip the graph - no classify_intent LLM call needed for this turn.
    if request.resume is None and request.message:
        canned = match_canned_response(request.message)
        if canned is not None:
            async def canned_stream() -> AsyncGenerator[str, None]:
                if canned["kind"] == "ui":
                    yield sse_event("ui", {"component": canned["component"], "props": canned["props"]})
                else:
                    yield sse_event("message", {"content": canned["content"]})
                yield sse_event("done", {"suggested_questions": []})

            return _sse_response(canned_stream())

    config = {"configurable": {"thread_id": request.thread_id}}
    if request.resume is not None:
        input_data: Any = Command(resume=request.resume)
    else:
        input_data = {"messages": [HumanMessage(content=request.message or "")]}

    graph = app.state.graph

    async def event_stream() -> AsyncGenerator[str, None]:
        interrupted = False
        try:
            async for stream_mode, chunk in graph.astream(
                input_data, config=config, stream_mode=["updates", "custom", "messages"]
            ):
                if stream_mode == "custom" and chunk.get("type") == "ui":
                    yield sse_event("ui", {"component": chunk["component"], "props": chunk["props"]})
                elif stream_mode == "custom" and chunk.get("type") == "message":
                    yield sse_event("message", {"content": chunk["content"]})
                elif stream_mode == "messages":
                    message_chunk, metadata = chunk
                    # Only the general-chat node produces user-facing prose via LLM token
                    # streaming; classify_intent, the other extract_<intent> nodes, and
                    # suggest_next_questions all stream structured-output JSON through the
                    # same "messages" channel and must not leak into the chat bubble.
                    if metadata.get("langgraph_node") != "extract_general":
                        continue
                    content = getattr(message_chunk, "content", "")
                    if content:
                        yield sse_event("message", {"content": content})
                elif stream_mode == "updates" and isinstance(chunk, dict) and "__interrupt__" in chunk:
                    interrupted = True
                    payload = chunk["__interrupt__"][0].value
                    yield sse_event("interrupt", payload)

            if not interrupted:
                state = await graph.aget_state(config)
                suggested = state.values.get("suggested_questions", []) if state else []
                yield sse_event("done", {"suggested_questions": suggested})
        except Exception as e:
            print(f"[chat] error: {e}", file=sys.stderr, flush=True)
            import traceback
            traceback.print_exc(file=sys.stderr)
            yield sse_event("error", {"message": str(e)})

    return _sse_response(event_stream())


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8003)
