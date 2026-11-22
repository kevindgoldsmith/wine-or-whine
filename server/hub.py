"""Live rooms in memory, their sockets, and snapshot persistence.

Single process, single replica: in-memory state is authoritative; every accepted change is written to
storage *before* it is broadcast, so a restart resumes exactly where the last message left off.
"""
from __future__ import annotations

import asyncio
import json
import logging
import secrets
import time
from dataclasses import dataclass, field
from typing import Optional

from fastapi import WebSocket, WebSocketDisconnect

from engine.boards import load_boards

from .config import Settings
from .rooms import TV_HOST, Room, RoomError, hash_secret, new_room_code
from .theme import announcements, load_themes
from .tts import TTS
from .views import message

log = logging.getLogger("wine.hub")

HELLO_TIMEOUT = 15.0
MSG_BURST = 40  # messages per 10 s per socket


@dataclass(eq=False)
class Conn:
    ws: WebSocket
    kind: str = "guest"  # guest | player | tv
    pid: Optional[str] = None
    tv_admin: bool = False  # a TV that proved it holds the room's host key
    stamps: list[float] = field(default_factory=list)

    def rate_ok(self) -> bool:
        now = time.monotonic()
        self.stamps = [t for t in self.stamps if now - t < 10]
        self.stamps.append(now)
        return len(self.stamps) <= MSG_BURST


class Hub:
    def __init__(self, settings: Settings, storage, tts: Optional[TTS] = None):
        self.settings = settings
        self.storage = storage
        self.themes = load_themes(settings.themes_dir)
        self.boards = load_boards(settings.boards_path)
        self.tts = tts or TTS("none", "", "", storage)
        self.rooms: dict[str, Room] = {}
        self.conns: dict[str, set[Conn]] = {}
        self.locks: dict[str, asyncio.Lock] = {}
        self.create_log: dict[str, list[float]] = {}
        self.base_url = settings.public_base_url
        self._request_base = ""

    # ------------------------------------------------------------ lifecycle
    async def load(self) -> None:
        await asyncio.to_thread(self.storage.init)
        rows = await asyncio.to_thread(self.storage.load_rooms)
        for code, state, version, status, _updated in rows:
            try:
                room = Room.from_dict(json.loads(state))
                room.version = version
                self.rooms[code] = room
            except Exception:
                log.exception("could not restore a room snapshot; skipping it")
        log.info("restored %d rooms (%d active games)", len(self.rooms), self.active_games())

    def active_games(self) -> int:
        return sum(1 for r in self.rooms.values() if r.status == "active")

    async def save(self, room: Room) -> None:
        room.version += 1
        blob = json.dumps(room.to_dict(), separators=(",", ":"))
        try:
            await asyncio.to_thread(self.storage.save_room, room.code, blob, room.version, room.status)
        except Exception as exc:  # memory stays authoritative; the next save retries
            log.error("snapshot save failed: %s", type(exc).__name__)

    async def flush_all(self) -> None:
        for room in list(self.rooms.values()):
            try:
                await self.save(room)
            except Exception:
                log.exception("flush failed")

    async def close_all(self, code: int = 1012, reason: str = "service restart") -> None:
        async def close(c: Conn) -> None:
            try:
                await asyncio.wait_for(c.ws.close(code=code, reason=reason), 1.0)
            except BaseException:
                pass

        conns = [c for cs in self.conns.values() for c in cs]
        if conns:
            await asyncio.wait([asyncio.create_task(close(c)) for c in conns], timeout=2.0)

    async def sweep(self, now: Optional[float] = None) -> int:
        """Delete rooms idle for 12 h (7 days for a game still in progress)."""
        now = time.time() if now is None else now
        removed = 0
        for code, room in list(self.rooms.items()):
            limit = self.settings.active_expiry_hours if room.status == "active" else self.settings.idle_expiry_hours
            if now - room.last_active > limit * 3600 and not self.conns.get(code):
                del self.rooms[code]
                self.locks.pop(code, None)
                await asyncio.to_thread(self.storage.delete_room, code)
                removed += 1
        if removed:
            log.info("swept %d expired rooms", removed)
        return removed

    async def close_room(self, code: str) -> None:
        for c in list(self.conns.pop(code, set())):
            await self.send(c, {"t": "error", "code": "room_missing"})
            try:
                await c.ws.close(code=4404)
            except Exception:
                pass
        self.rooms.pop(code, None)
        self.locks.pop(code, None)
        await asyncio.to_thread(self.storage.delete_room, code)

    async def ping_all(self) -> None:
        for conns in list(self.conns.values()):
            for c in list(conns):
                try:
                    await c.ws.send_text('{"t":"ping"}')
                except Exception:
                    pass

    # ------------------------------------------------------------ rooms
    def create_room(self, ip: str, theme: Optional[str] = None, from_tv: bool = False) -> tuple[Room, str]:
        now = time.time()
        recent = [t for t in self.create_log.get(ip, []) if now - t < 3600]
        if len(recent) >= self.settings.room_creates_per_hour:
            raise RoomError("rate_limited")
        if len(self.rooms) >= self.settings.max_rooms:
            raise RoomError("too_many_rooms")
        recent.append(now)
        self.create_log[ip] = recent
        if len(self.create_log) > 5000:
            self.create_log = {k: v for k, v in self.create_log.items() if v and now - v[-1] < 3600}
        host_key = secrets.token_urlsafe(18)
        room = Room(code=new_room_code(self.rooms), host_key_hash=hash_secret(host_key), tv_hosted=from_tv,
                    host_id=TV_HOST if from_tv else None)
        if theme in self.themes:
            room.theme = theme
        self.rooms[room.code] = room
        return room, host_key

    def join_url(self, room: Room, base: str = "") -> str:
        return f"{(self.base_url or base).rstrip('/')}/{room.code}"

    def online(self, code: str) -> set[str]:
        return {c.pid for c in self.conns.get(code, set()) if c.kind == "player" and c.pid}

    async def send(self, c: Conn, msg: dict) -> None:
        try:
            await c.ws.send_text(json.dumps(msg, separators=(",", ":")))
        except Exception:
            pass

    async def push_state(self, room: Room, events: Optional[list[dict]] = None, only: Optional[Conn] = None) -> None:
        online = self.online(room.code)
        url = self.join_url(room, self._request_base)
        say = []
        if events and room.voice:
            theme = self.themes.get(room.theme) or next(iter(self.themes.values()))
            for text in announcements(theme, events, room.names_by_seat()):
                item = {"text": text}
                if self.tts.enabled:
                    item["url"] = f"/api/tts/{self.tts.register(text)}"
                say.append(item)
        targets = [only] if only else list(self.conns.get(room.code, set()))
        for c in targets:
            msg = message(room, c.kind, c.pid, online, url, events if not only else [], say if not only else [])
            if c.kind == "tv":
                msg["tv_admin"] = c.tv_admin
            await self.send(c, msg)

    # ------------------------------------------------------------ sockets
    async def serve(self, ws: WebSocket, code: str, base: str) -> None:
        if not self.base_url:
            self._request_base = base
        await ws.accept()
        room = self.rooms.get(code)
        if room is None:
            await ws.send_text('{"t":"error","code":"room_missing"}')
            await ws.close(code=4404)
            return
        conn = Conn(ws)
        self.conns.setdefault(code, set()).add(conn)
        try:
            raw = await asyncio.wait_for(ws.receive_text(), HELLO_TIMEOUT)
            await self.on_message(conn, code, raw)
            while True:
                raw = await ws.receive_text()
                await self.on_message(conn, code, raw)
        except (WebSocketDisconnect, asyncio.TimeoutError, RuntimeError):
            pass
        except Exception:
            log.exception("socket handler crashed")
        finally:
            self.conns.get(code, set()).discard(conn)
            room = self.rooms.get(code)
            if room is not None and conn.kind == "player":
                await self.push_state(room)  # online dots update

    def lock(self, code: str) -> asyncio.Lock:
        return self.locks.setdefault(code, asyncio.Lock())

    async def on_message(self, conn: Conn, code: str, raw: str) -> None:
        if len(raw) > self.settings.max_message_bytes:
            await self.send(conn, {"t": "error", "code": "too_big"})
            return
        if not conn.rate_ok():
            await self.send(conn, {"t": "error", "code": "rate_limited"})
            return
        try:
            msg = json.loads(raw)
            assert isinstance(msg, dict)
        except Exception:
            await self.send(conn, {"t": "error", "code": "bad_request"})
            return
        t = msg.get("t")
        if t == "pong":
            return
        async with self.lock(code):
            room = self.rooms.get(code)
            if room is None:
                await self.send(conn, {"t": "error", "code": "room_missing"})
                return
            try:
                await self._dispatch(conn, room, t, msg)
            except RoomError as exc:
                await self.send(conn, {"t": "error", "code": exc.code, "id": msg.get("id")})

    async def _dispatch(self, conn: Conn, room: Room, t, msg: dict) -> None:
        if t == "hello":
            if msg.get("kind") == "tv":
                conn.kind, conn.pid = "tv", None
                conn.tv_admin = room.tv_hosted and room.check_host_key(msg.get("host_key"))
                if msg.get("host_key") and not conn.tv_admin:
                    await self.send(conn, {"t": "error", "code": "not_host"})
            else:
                p = room.by_token(str(msg.get("token") or ""))
                if p:
                    conn.kind, conn.pid = "player", p.id
                    await self.send(conn, {"t": "welcome", "player_id": p.id})
                    await self.push_state(room)  # everyone sees them come online
                    return
                conn.kind, conn.pid = "guest", None
                if msg.get("token"):
                    await self.send(conn, {"t": "error", "code": "bad_token"})
            await self.push_state(room, only=conn)
            return
        if t == "join":
            p, token = room.join(msg.get("name", ""), msg.get("host_key"))
            conn.kind, conn.pid = "player", p.id
            await self.save(room)
            await self.send(conn, {"t": "welcome", "player_id": p.id, "token": token})
            await self.push_state(room)
            return
        if t == "rejoin":
            p, token = room.rejoin(str(msg.get("player_id", "")), str(msg.get("code", "")))
            await self.save(room)
            # Sign out any other phone that held this seat.
            for other in list(self.conns.get(room.code, set())):
                if other is not conn and other.kind == "player" and other.pid == p.id:
                    other.kind, other.pid = "guest", None
                    await self.send(other, {"t": "signed_out"})
            conn.kind, conn.pid = "player", p.id
            await self.send(conn, {"t": "welcome", "player_id": p.id, "token": token})
            await self.push_state(room)
            return
        if conn.kind == "tv" and conn.tv_admin and t == "host":
            actor = TV_HOST  # the TV acts for itself; it can always reassign hosting since it owns the room
        elif conn.kind != "player" or conn.pid is None or room.player(conn.pid) is None:
            raise RoomError("not_joined")
        else:
            actor = conn.pid
        action_id = msg.get("id")
        if action_id is not None and (not isinstance(action_id, str) or len(action_id) > 64):
            raise RoomError("bad_request")
        if room.seen_action(action_id):
            await self.send(conn, {"t": "ack", "id": action_id, "dup": True})
            return
        if t == "act":
            if actor == TV_HOST:
                raise RoomError("not_joined")
            events = room.game_action(actor, msg.get("a") or {})
        elif t == "host":
            a = msg.get("a") or {}
            if not isinstance(a, dict):
                raise RoomError("bad_request")
            if a.get("type") == "rejoin_codes":  # host phone: the whole list, on their own screen
                if actor == TV_HOST or actor != room.host_id:
                    raise RoomError("not_host")
                codes = [{"id": p.id, "name": p.name, "code": p.rejoin} for p in room.players]
                await self.send(conn, {"t": "rejoin_codes", "codes": codes})
                return
            if a.get("type") == "rejoin_code":  # TV: one player's code at a time (it's a shared screen)
                p = room.player(a.get("player_id"))
                if actor != TV_HOST or not p:
                    raise RoomError("not_host")
                await self.send(conn, {"t": "rejoin_code", "player_id": p.id, "name": p.name, "code": p.rejoin})
                return
            if actor == TV_HOST and a.get("type") == "make_host" and room.host_id != TV_HOST:
                # The owning TV may take hosting back, or move it, even while a phone hosts.
                actor = room.host_id or TV_HOST
            kicked = a.get("player_id") if a.get("type") == "kick" else None
            events = room.host_action(actor, a, self.boards, self.themes)
            if kicked:
                for other in list(self.conns.get(room.code, set())):
                    if other.pid == kicked:
                        other.kind, other.pid = "guest", None
                        await self.send(other, {"t": "kicked"})
        else:
            raise RoomError("bad_request")
        room.remember_action(action_id)
        await self.save(room)
        await self.send(conn, {"t": "ack", "id": action_id})
        await self.push_state(room, events)
