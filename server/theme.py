"""Theme files (themes/*.json): every player-facing word lives there."""
from __future__ import annotations

import json
import re
from pathlib import Path

_VAR = re.compile(r"\{(\w+)\}")
_TERM = re.compile(r"\[(\w+)\]")


def load_themes(directory: Path) -> dict[str, dict]:
    themes = {}
    for f in sorted(directory.glob("*.json")):
        data = json.loads(f.read_text(encoding="utf-8"))
        themes[data["id"]] = data
    if not themes:
        raise RuntimeError("no themes found")
    return themes


def fmt(theme: dict, template: str, **values) -> str:
    """``{var}`` comes from ``values``; ``[term]`` comes from the theme's terms."""
    terms = theme.get("terms", {})
    out = _TERM.sub(lambda m: str(terms.get(m.group(1), m.group(0))), template)
    return _VAR.sub(lambda m: str(values.get(m.group(1), m.group(0))), out)


def announcements(theme: dict, events: list[dict], names: list[str]) -> list[str]:
    """Spoken lines for the TV, one per notable event, built from the theme's ``announce`` templates."""
    A = theme.get("announce", {})
    out: list[str] = []

    def say(key: str, **kw) -> None:
        if key in A:
            out.append(fmt(theme, A[key], **kw))

    def nm(seat) -> str:
        return names[seat] if seat is not None and 0 <= seat < len(names) else ""

    for e in events:
        t = e["type"]
        if t == "day_start":
            say("day_start", day=e["day"], pres=nm(e["president"]))
        elif t == "nominated":
            say("nominated", pres=nm(e["president"]), nominee=nm(e["nominee"]))
        elif t == "vote_result":
            say("vote_pass" if e["passed"] else "vote_fail")
        elif t == "forced":
            say("forced")
        elif t == "government":
            say("shh")
        elif t == "enacted":
            say("enacted_" + e["card"])
        elif t == "veto_proposed":
            say("veto_proposed", planner=nm(e["chancellor"]))
        elif t == "veto_result":
            say("veto_accepted" if e["accepted"] else "veto_refused")
        elif t == "power_used":
            say("power_" + e["power"], pres=nm(e["president"]), target=nm(e["target"]))
        elif t == "power" and e["power"] == "peek":
            say("power_peek", pres=nm(e["president"]))
        elif t == "game_over":
            say("game_over_" + e["winner"])
    return out
