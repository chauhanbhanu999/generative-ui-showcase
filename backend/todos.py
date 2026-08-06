from __future__ import annotations

import uuid
from typing import Any

import ai


# ── State types ──────────────────────────────────────────────────────────────

class Todo(dict):
    """A single todo item: {id, title, completed}"""


# In-memory shared state (persists for the lifetime of the server process)
_todos: list[dict[str, Any]] = []


def get_todos_state() -> list[dict[str, Any]]:
    return _todos


def set_todos_state(todos: list[dict[str, Any]]) -> None:
    global _todos
    _todos = todos


# ── Agent tools ───────────────────────────────────────────────────────────────

@ai.tool
async def manage_todos(todos: list[dict[str, Any]]) -> dict:
    """Replace the entire todo list. Use this to add, edit, or remove todos.
    Each todo must have: title (str), completed (bool). id is optional and will be generated."""
    for todo in todos:
        if not todo.get("id"):
            todo["id"] = str(uuid.uuid4())
    set_todos_state(todos)
    return {"success": True, "count": len(todos), "todos": todos}


@ai.tool
async def get_todos() -> list[dict[str, Any]]:
    """Get the current todo list."""
    return get_todos_state()


@ai.tool
async def open_or_close_todos(open: bool) -> dict:
    """Signal the frontend to open or close the todo panel. Returns the requested state."""
    return {"open": open}


TODO_TOOLS = [manage_todos, get_todos, open_or_close_todos]
