from __future__ import annotations

import json
from pathlib import Path
from typing import Any

DATA_DIR = Path(__file__).resolve().parents[1] / "data"


def load_json(filename: str) -> Any:
    with open(DATA_DIR / filename, encoding="utf-8") as f:
        return json.load(f)
