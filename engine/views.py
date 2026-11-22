"""Per-recipient views of the engine state. The only way state leaves the engine.

Never return the raw state. Every field below is either public, or private to exactly the viewer.
"""
from __future__ import annotations

from typing import Optional

from .game import GameState, eligible_nominees, living_count, power_targets, term_limited, veto_unlocked, waiting_on


def public_view(s: GameState) -> dict:
    over = s.phase == "game_over"
    v = {
        "n": s.n,
        "phase": s.phase,
        "day": s.day,
        "alive": list(s.alive),
        "living": living_count(s),
        "president": s.president,
        "nominee": s.nominee,
        "chancellor": s.chancellor,
        "term_limited": term_limited(s),
        "eligible": eligible_nominees(s) if s.phase == "nominate" else [],
        "breezy": s.breezy,
        "over": s.over,
        "meter": s.meter,
        "deck_count": len(s.deck),
        "discard_count": len(s.discard),
        "board": list(s.board),
        "veto_unlocked": veto_unlocked(s),
        "veto_refused": s.veto_refused,
        "power": s.power,
        "power_targets": power_targets(s),
        "investigated": list(s.investigated),
        "waiting_on": waiting_on(s),
        "acked": list(s.acks) if s.phase == "reveal" else [],
        "voted": [p for p in range(s.n) if s.votes[p] is not None] if s.phase == "vote" else [],
        "last_vote": s.last_vote,
        "history": s.history,
        "winner": s.winner,
        "win_reason": s.win_reason,
        "roles": list(s.roles) if over else None,
        "superlatives": s.superlatives if over else [],
    }
    return v


def known_roles(s: GameState, seat: int) -> dict[int, str]:
    """Roles ``seat`` legitimately knows (own role, and teammates where the rules allow)."""
    if s.phase == "game_over":
        return dict(enumerate(s.roles))
    mine = s.roles[seat]
    known = {seat: mine}
    if mine == "over" or (mine == "chief" and s.n <= 6):
        for p, r in enumerate(s.roles):
            if r in ("over", "chief"):
                known[p] = r
    return known


def player_view(s: GameState, seat: int) -> dict:
    v = public_view(s)
    hand: Optional[list[str]] = None
    if s.phase == "pres_discard" and seat == s.president:
        hand = list(s.hand)
    elif s.phase in ("chanc_enact", "veto_response") and seat == s.chancellor:
        hand = list(s.hand)
    v.update(
        {
            "me": seat,
            "role": s.roles[seat],
            "known": {str(p): r for p, r in known_roles(s, seat).items()},
            "hand": hand,
            "my_vote": s.votes[seat] if s.phase == "vote" else None,
            "pending_result": s.pending_result if seat == s.president and s.phase == "power_result" else None,
            "private_results": list(s.private[seat]),
            "phone_read_by": [
                e["president"] for e in s.history
                if e["type"] == "power_used" and e["power"] == "investigate" and e["target"] == seat
            ],
        }
    )
    return v


def tv_view(s: GameState) -> dict:
    return public_view(s)


def spectator_view(s: GameState, seat: int) -> dict:
    v = public_view(s)
    v.update({"me": seat, "role": s.roles[seat], "spectator": True})
    return v
