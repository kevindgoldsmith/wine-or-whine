"""Power boards. ``load_boards`` reads config/boards.json; everything else is pure."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from .game import validate_board

DEFAULT_PATH = Path(__file__).resolve().parent.parent / "config" / "boards.json"


def load_boards(path: Path = DEFAULT_PATH) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def bracket(n: int) -> str:
    if n <= 6:
        return "5-6"
    if n <= 8:
        return "7-8"
    return "9-10"


def board_for(n: int, boards: dict, overrides: Optional[dict] = None) -> list[Optional[str]]:
    """The official board for ``n`` players, with optional house-rule overrides.

    ``overrides`` maps a bracket ("5-6", "7-8", "9-10") to a full 5-slot list.
    """
    key = bracket(n)
    if overrides and key in overrides:
        return validate_board(list(overrides[key]))
    return validate_board(list(boards["official"][key]))
