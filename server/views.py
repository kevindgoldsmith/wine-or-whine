"""Builds every outgoing message, per recipient. Nothing else may serialize a room or game state.

- ``view_for_player``: the engine player view (own role, known teammates, own hand/results) + public info
- ``view_for_spectator``: the TV view + the player's own role (players on babysitter duty)
- ``view_for_tv``: public information only
"""
from __future__ import annotations

from typing import Optional

from engine.views import player_view, spectator_view, tv_view

from .rooms import Room


def room_public(room: Room, online: set[str], join_url: str) -> dict:
    return {
        "code": room.code,
        "status": room.status,
        "paused": room.paused,
        "theme": room.theme,
        "hints": room.hints,
        "voice": room.voice,
        "test_mode": room.test_mode,
        "house": room.house,
        "host_id": room.host_id,
        "tv_hosted": room.tv_hosted,
        "games_played": room.games_played,
        "join_url": join_url,
        "players": [
            {"id": p.id, "name": p.name, "online": p.id in online} for p in room.players
        ],
        "seat_ids": list(room.seat_ids),
    }


def view_for_player(room: Room, pid: str) -> Optional[dict]:
    g = room.game
    if g is None:
        return None
    seat = room.seat_of(pid)
    if seat is None:
        return tv_view(g)
    if not g.alive[seat] and g.phase != "game_over":
        return view_for_spectator(room, pid)
    return player_view(g, seat)


def view_for_spectator(room: Room, pid: str) -> Optional[dict]:
    g = room.game
    seat = room.seat_of(pid)
    if g is None or seat is None:
        return None
    return spectator_view(g, seat)


def view_for_tv(room: Room) -> Optional[dict]:
    return tv_view(room.game) if room.game else None


def message(room: Room, kind: str, pid: Optional[str], online: set[str], join_url: str,
            events: Optional[list[dict]] = None, say: Optional[list[dict]] = None) -> dict:
    """The one ``state`` message for a recipient. ``kind`` is tv | player | guest."""
    msg: dict = {"t": "state", "room": room_public(room, online, join_url), "events": events or []}
    if kind == "tv":
        msg["game"] = view_for_tv(room)
        msg["say"] = say or []
    elif kind == "player" and pid is not None:
        p = room.player(pid)
        msg["me"] = {"id": pid, "name": p.name if p else "", "host": pid == room.host_id}
        msg["game"] = view_for_player(room, pid)
    else:
        msg["game"] = None
    return msg
