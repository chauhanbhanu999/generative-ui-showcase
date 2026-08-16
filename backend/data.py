from __future__ import annotations

import csv
from collections import defaultdict
from pathlib import Path
from typing import Any

from langchain_core.tools import tool

CSV_PATH = Path(__file__).resolve().parents[1] / "db.csv"


def get_category_summary() -> list[dict[str, Any]]:
    """Aggregate totals by subcategory from db.csv, as {label, value} pairs."""
    totals: dict[str, float] = defaultdict(float)
    with CSV_PATH.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            totals[row["subcategory"]] += float(row["amount"])
    return [{"label": k, "value": v} for k, v in totals.items()]


@tool
def query_data(query: str) -> list[dict[str, Any]]:
    """Query the raw dataset. Returns all CSV rows. `query` is unused (no filtering
    is implemented) but documents intent for the model calling this tool."""
    with CSV_PATH.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        return list(reader)
