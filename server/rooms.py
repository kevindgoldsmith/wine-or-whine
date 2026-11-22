"""Rooms: lobby, seats, rejoin, host controls, and the bridge to the pure engine.

Everything here is synchronous and free of I/O so it can be unit-tested; ``server.hub`` owns sockets
and persistence.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
import time
from dataclasses import asdict, dataclass, field
from typing import Optional

from engine.boards import board_for
from engine.game import GameState, IllegalAction, apply, new_game, validate_board

log = logging.getLogger("wine.rooms")

CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ"  # no I, L, O (and no digits) to avoid mix-ups
MIN_PLAYERS, MAX_PLAYERS = 5, 10
MAX_NAME = 20
REJOIN_FAILS_PER_WINDOW = 8
REJOIN_WINDOW = 600.0


class RoomError(Exception):
    """A rejected request. ``code`` is a short, secret-free identifier the client can translate."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def new_room_code(taken) -> str:
    for _ in range(1000):
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(4))
        if code not in taken:
            return code
    raise RoomError("no_codes")


def hash_secret(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _same(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


@dataclass
class Player:
    id: str
    name: str
    token_hash: str
    rejoin: str


@dataclass
class Room:
    code: str
    host_key_hash: str
    theme: str = "wine_or_whine"
    players: list[Player] = field(default_factory=list)
    host_id: Optional[str] = None
    status: str = "lobby"  # lobby | active | over
    paused: bool = False
    hints: bool = True
    voice: bool = True
    house: dict = field(default_factory=dict)  # bracket -> 5-slot list
    game: Optional[GameState] = None
    seat_ids: list[str] = field(default_factory=list)
    games_played: int = 0
    version: int = 0
    recent_action_ids: list[str] = field(default_factory=list)
    rejoin_failures: list[float] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    last_active: float = field(default_factory=time.time)

    # ------------------------------------------------------------ persistence
    def to_dict(self) -> dict:
        d = asdict(self)
        d["game"] = self.game.to_dict() if self.game else None
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "Room":
        d = dict(d)
        d["players"] = [Player(**p) for p in d.get("players", [])]
        d["game"] = GameState.from_dict(d["game"]) if d.get("game") else None
        return cls(**d)

    # ------------------------------------------------------------ lookups
    def player(self, pid: Optional[str]) -> Optional[Player]:
        return next((p for p in self.players if p.id == pid), None)

    def by_token(self, token: str) -> Optional[Player]:
        if not token or len(token) > 100:
            return None
        h = hash_secret(token)
        return next((p for p in self.players if _same(p.token_hash, h)), None)

    def seat_of(self, pid: str) -> Optional[int]:
        try:
            return self.seat_ids.index(pid) if self.game else None
        except ValueError:
            return None

    def names_by_seat(self) -> list[str]:
        out = []
        for pid in self.seat_ids:
            p = self.player(pid)
            out.append(p.name if p else "?")
        return out

    def touch(self) -> None:
        self.last_active = time.time()

    # ------------------------------------------------------------ idempotency
    def seen_action(self, action_id: Optional[str]) -> bool:
        return bool(action_id) and action_id in self.recent_action_ids

    def remember_action(self, action_id: Optional[str]) -> None:
        if action_id:
            self.recent_action_ids.append(action_id)
            del self.recent_action_ids[:-300]

    # ------------------------------------------------------------ joining
    def join(self, name: str, host_key: Optional[str] = None) -> tuple[Player, str]:
        name = " ".join(str(name or "").split())[:MAX_NAME]
        if not name:
            raise RoomError("bad_name")
        if self.status != "lobby":
            raise RoomError("game_started")
        if len(self.players) >= MAX_PLAYERS:
            raise RoomError("room_full")
        if any(p.name.casefold() == name.casefold() for p in self.players):
            raise RoomError("name_taken")
        token = secrets.token_urlsafe(24)
        taken = {p.rejoin for p in self.players}
        rejoin = next(c for c in (f"{secrets.randbelow(10000):04d}" for _ in range(1000)) if c not in taken)
        p = Player(id=secrets.token_hex(4), name=name, token_hash=hash_secret(token), rejoin=rejoin)
        self.players.append(p)
        if self.host_id is None and host_key and _same(hash_secret(host_key), self.host_key_hash):
            self.host_id = p.id
        self.touch()
        return p, token

    def rejoin(self, pid: str, code: str, now: Optional[float] = None) -> tuple[Player, str]:
        """Claim a seat with its 4-digit rejoin code. Rotates the seat token (old phone is signed out)."""
        now = time.time() if now is None else now
        self.rejoin_failures = [t for t in self.rejoin_failures if now - t < REJOIN_WINDOW]
        if len(self.rejoin_failures) >= REJOIN_FAILS_PER_WINDOW:
            raise RoomError("rate_limited")
        p = self.player(pid)
        if not p or not isinstance(code, str) or not _same(p.rejoin, code.strip()):
            self.rejoin_failures.append(now)
            raise RoomError("bad_code")
        token = secrets.token_urlsafe(24)
        p.token_hash = hash_secret(token)
        self.touch()
        return p, token

    # ------------------------------------------------------------ host controls
    def host_action(self, pid: str, a: dict, boards: dict, themes: dict) -> list[dict]:
        if pid != self.host_id:
            raise RoomError("not_host")
        t = a.get("type") if isinstance(a, dict) else None
        if t == "reorder":
            self._need_lobby()
            order = a.get("order")
            if not isinstance(order, list) or sorted(order) != sorted(p.id for p in self.players):
                raise RoomError("bad_request")
            by_id = {p.id: p for p in self.players}
            self.players = [by_id[i] for i in order]
        elif t == "kick":
            self._need_lobby()
            target = a.get("player_id")
            if target == self.host_id or not self.player(target):
                raise RoomError("bad_request")
            self.players = [p for p in self.players if p.id != target]
        elif t == "make_host":
            if not self.player(a.get("player_id")):
                raise RoomError("bad_request")
            self.host_id = a["player_id"]
        elif t == "settings":
            self._need_lobby()
            if "theme" in a:
                if a["theme"] not in themes:
                    raise RoomError("bad_request")
                self.theme = a["theme"]
            for flag in ("hints", "voice"):
                if flag in a:
                    if not isinstance(a[flag], bool):
                        raise RoomError("bad_request")
                    setattr(self, flag, a[flag])
            if "house" in a:
                house = a["house"]
                if not isinstance(house, dict):
                    raise RoomError("bad_request")
                clean = {}
                for key, slots in house.items():
                    if key not in boards["official"]:
                        raise RoomError("bad_request")
                    try:
                        clean[key] = validate_board(slots)
                    except ValueError:
                        raise RoomError("bad_board")
                    if clean[key] == boards["official"][key]:
                        del clean[key]
                self.house = clean
        elif t == "voice":
            if not isinstance(a.get("on"), bool):
                raise RoomError("bad_request")
            self.voice = a["on"]
        elif t == "start":
            self._need_lobby()
            return self._start(boards)
        elif t == "play_again":
            if self.status != "over":
                raise RoomError("bad_phase")
            # Rules hints are on by default for the first game only.
            self.hints = a.get("hints") is True
            return self._start(boards)
        elif t == "back_to_lobby":
            if self.status != "over":
                raise RoomError("bad_phase")
            self.status = "lobby"
            self.game = None
            self.seat_ids = []
        elif t in ("pause", "resume"):
            if self.status != "active":
                raise RoomError("bad_phase")
            self.paused = t == "pause"
        else:
            raise RoomError("bad_request")
        self.touch()
        return []

    def _need_lobby(self) -> None:
        if self.status != "lobby":
            raise RoomError("bad_phase")

    def _start(self, boards: dict) -> list[dict]:
        n = len(self.players)
        if not MIN_PLAYERS <= n <= MAX_PLAYERS:
            raise RoomError("need_players")
        self.seat_ids = [p.id for p in self.players]
        self.game, events = new_game(n, secrets.randbits(64), board_for(n, boards, self.house))
        self.status = "active"
        self.paused = False
        self.games_played += 1
        self.touch()
        return events

    # ------------------------------------------------------------ game actions
    def game_action(self, pid: str, a: dict) -> list[dict]:
        if self.status != "active" or self.game is None:
            raise RoomError("bad_phase")
        if self.paused:
            raise RoomError("paused")
        seat = self.seat_of(pid)
        if seat is None:
            raise RoomError("not_in_game")
        try:
            self.game, events = apply(self.game, seat, a)
        except IllegalAction as exc:
            # Log seat, phase and reason only: never roles, hands, votes or results.
            log.info("rejected action room=%s seat=%s phase=%s reason=%s", self.code, seat, self.game.phase, exc.reason)
            raise RoomError("illegal") from exc
        if self.game.phase == "game_over":
            self.status = "over"
        self.touch()
        return events
