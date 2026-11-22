"""End-to-end: a real uvicorn process, 8 WebSocket phones and a TV play a full game.

Also: one phone drops and reconnects mid-vote, and the server is restarted (SIGTERM, like a Railway
deploy) mid-game; every client must reconnect on its own and the game must resume within 10 s.
Run against a deployed server with E2E_BASE_URL=https://... (skips the restart part).
"""
from __future__ import annotations

import asyncio
import json
import os
import random
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx
import pytest
import websockets

ROOT = Path(__file__).resolve().parent.parent


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Server:
    def __init__(self, port: int, db: str):
        self.port, self.db = port, db
        self.proc: subprocess.Popen | None = None

    def start(self):
        env = dict(os.environ, SQLITE_PATH=self.db, DATABASE_URL="", PING_SECONDS="2", TTS_PROVIDER="none",
                   PUBLIC_BASE_URL="")
        self.proc = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "server.main:app", "--host", "127.0.0.1", "--port", str(self.port),
             "--timeout-graceful-shutdown", "3"],
            cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
        )
        deadline = time.time() + 20
        while time.time() < deadline:
            try:
                if httpx.get(f"http://127.0.0.1:{self.port}/livez", timeout=0.5).status_code == 200:
                    return
            except httpx.HTTPError:
                time.sleep(0.1)
        raise RuntimeError("server did not start")

    def stop(self):
        if self.proc and self.proc.poll() is None:
            self.proc.send_signal(signal.SIGTERM)
            try:
                self.proc.wait(10)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        if self.proc and self.proc.stderr:
            self.log = self.proc.stderr.read().decode(errors="replace")


class Bot:
    """A phone: reconnects with backoff and its seat token, acts from its own view only."""

    def __init__(self, name: str, ws_url: str, host_key=None, seed=0):
        self.name, self.ws_url, self.host_key = name, ws_url, host_key
        self.rng = random.Random(seed)
        self.token = None
        self.pid = None
        self.state = None
        self.messages: list[dict] = []
        self.close_codes: list[int] = []
        self.acted = set()
        self.drop_in_vote = False
        self.dropped = False
        self.reconnected_at = None
        self.ws = None
        self.pending: dict[str, dict] = {}  # unacknowledged actions, resent after reconnecting (like web/src/net.ts)
        self.done = asyncio.Event()

    async def run(self):
        delay = 0.5
        while not self.done.is_set():
            try:
                async with websockets.connect(self.ws_url, open_timeout=5) as ws:
                    self.ws = ws
                    delay = 0.5
                    await ws.send(json.dumps({"t": "hello", "kind": "player", "token": self.token}))
                    if self.token is None:
                        await ws.send(json.dumps({"t": "join", "name": self.name, "host_key": self.host_key}))
                    for msg in list(self.pending.values()):
                        await ws.send(json.dumps(msg))
                    async for raw in ws:
                        await self.on(json.loads(raw))
                        if self.done.is_set():
                            return
            except websockets.ConnectionClosed as e:
                if e.rcvd:
                    self.close_codes.append(e.rcvd.code)
            except (OSError, asyncio.TimeoutError, websockets.InvalidHandshake):
                pass
            if self.done.is_set():
                return
            await asyncio.sleep(delay * (0.75 + random.random() * 0.5))
            delay = min(delay * 2, 5)

    async def send(self, msg):
        try:
            await self.ws.send(json.dumps(msg))
        except websockets.ConnectionClosed:
            pass

    async def on(self, m):
        if m["t"] == "ping":
            await self.send({"t": "pong"})
            return
        if m["t"] in ("ack", "error") and m.get("id"):
            self.pending.pop(m["id"], None)
        if m["t"] == "welcome":
            self.pid = m["player_id"]
            self.token = m.get("token", self.token)
            return
        if m["t"] != "state":
            return
        self.messages.append(m)
        self.state = m
        if self.reconnected_at is None and self.dropped:
            self.reconnected_at = time.time()
        g = m.get("game")
        if not g or "me" not in m:
            return
        if g["phase"] == "game_over":
            self.done.set()
            return
        me = g.get("me")
        if me is None or g.get("spectator") or m["room"]["paused"]:
            return
        if g["phase"] == "reveal":
            if me not in g["acked"]:
                await self.act({"type": "ack_role"}, ("reveal",))
            return
        if me not in g["waiting_on"]:
            return
        key = (g["day"], g["phase"], len(g["history"]), g["veto_refused"])
        if key in self.acted:
            return
        if g["phase"] == "vote" and self.drop_in_vote and not self.dropped:
            self.dropped = True
            await self.ws.close()  # drop mid-vote, before voting
            return
        r = self.rng
        ph = g["phase"]
        if ph == "nominate":
            a = {"type": "nominate", "target": r.choice(g["eligible"])}
        elif ph == "vote":
            a = {"type": "vote", "yes": r.random() < 0.65}
        elif ph == "pres_discard":
            a = {"type": "discard", "index": r.randrange(len(g["hand"]))}
        elif ph == "chanc_enact":
            if g["veto_unlocked"] and not g["veto_refused"] and r.random() < 0.3:
                a = {"type": "propose_veto"}
            else:
                a = {"type": "enact", "index": r.randrange(len(g["hand"]))}
        elif ph == "veto_response":
            a = {"type": "veto", "accept": r.random() < 0.5}
        elif ph == "power":
            a = {"type": "power_target", "target": r.choice(g["power_targets"])}
        elif ph == "power_result":
            a = {"type": "power_ack"}
        else:
            return
        await self.act(a, key)

    async def act(self, a, key):
        self.acted.add(key)
        msg = {"t": "act", "id": f"{self.name}-{len(self.acted)}-{time.time()}", "a": a}
        self.pending[msg["id"]] = msg
        await self.send(msg)


class Tv:
    def __init__(self, ws_url):
        self.ws_url = ws_url
        self.messages = []
        self.done = asyncio.Event()

    async def run(self):
        while not self.done.is_set():
            try:
                async with websockets.connect(self.ws_url) as ws:
                    await ws.send(json.dumps({"t": "hello", "kind": "tv"}))
                    async for raw in ws:
                        m = json.loads(raw)
                        if m["t"] == "state":
                            self.messages.append(m)
                            if m["game"] and m["game"]["phase"] == "game_over":
                                self.done.set()
                                return
            except (websockets.ConnectionClosed, OSError, websockets.InvalidHandshake):
                await asyncio.sleep(0.5)


def check_wire_leaks(bots: list[Bot], tv: Tv):
    final = bots[0].state["game"]
    roles = final["roles"]
    seats = bots[0].state["room"]["seat_ids"]
    for b in bots:
        seat = seats.index(b.pid)
        for m in b.messages:
            g = m["game"]
            if not g or g["phase"] == "game_over":
                continue
            assert "votes" not in g and "deck" not in g and "rng" not in g
            if g.get("spectator"):
                assert "known" not in g and "hand" not in g
                continue
            known = {int(k): v for k, v in g["known"].items()}
            assert known[seat] == roles[seat]
            if roles[seat] == "chill" or (roles[seat] == "chief" and len(seats) > 6):
                assert set(known) == {seat}, "a player learned a role they shouldn't"
            for s, r in known.items():
                assert roles[s] == r
            if g["hand"] is not None:
                assert (g["phase"] == "pres_discard" and g["president"] == seat) or (
                    g["phase"] in ("chanc_enact", "veto_response") and g["chancellor"] == seat)
            if g["pending_result"] is not None:
                assert g["president"] == seat
            assert g["roles"] is None
    for m in tv.messages:
        g = m["game"]
        if g and g["phase"] != "game_over":
            assert g["roles"] is None
            for k in ("role", "known", "hand", "pending_result", "private_results", "my_vote"):
                assert k not in g


async def play(base_http: str, server: Server | None, n=8):
    async with httpx.AsyncClient(base_url=base_http) as http:
        room = (await http.post("/api/rooms")).json()
    code = room["code"]
    ws_base = base_http.replace("http", "ws", 1)
    url = f"{ws_base}/ws/{code}"
    tv = Tv(url)
    tv_task = asyncio.create_task(tv.run())
    bots = [Bot("Host", url, room["host_key"], seed=1)]
    tasks = [asyncio.create_task(bots[0].run())]
    await asyncio.sleep(0.3)
    for i in range(1, n):
        bots.append(Bot(f"P{i}", url, seed=i + 1))
        tasks.append(asyncio.create_task(bots[i].run()))
    bots[3].drop_in_vote = True
    for _ in range(100):
        if bots[0].state and len(bots[0].state["room"]["players"]) == n:
            break
        await asyncio.sleep(0.05)
    await bots[0].send({"t": "host", "id": "start", "a": {"type": "start"}})

    restart_info = {}
    if server is not None:
        # Restart mid-game once day 3 is under way (and before the game can have ended).
        for _ in range(400):
            g = bots[0].state and bots[0].state["game"]
            if g and g["day"] >= 3 and g["phase"] != "game_over":
                break
            await asyncio.sleep(0.02)
        g = bots[0].state["game"]
        if g["phase"] != "game_over":
            before = {b.name: len(b.messages) for b in bots}
            await asyncio.to_thread(server.stop)
            t0 = time.time()
            await asyncio.to_thread(server.start)
            # Every phone must be back (fresh state message) within 10 s of the server being up again.
            for _ in range(200):
                if all(len(b.messages) > before[b.name] for b in bots):
                    break
                await asyncio.sleep(0.05)
            restart_info = {"resume_seconds": time.time() - t0,
                            "all_back": all(len(b.messages) > before[b.name] for b in bots),
                            "codes": [b.close_codes[-1] if b.close_codes else None for b in bots]}

    await asyncio.wait_for(asyncio.gather(*(b.done.wait() for b in bots)), timeout=90)
    await asyncio.wait_for(tv.done.wait(), timeout=10)
    for t in tasks + [tv_task]:
        t.cancel()
    return code, bots, tv, restart_info


def test_full_game_with_drop_and_restart(tmp_path):
    base = os.environ.get("E2E_BASE_URL")
    server = None
    if not base:
        port = free_port()
        server = Server(port, str(tmp_path / "e2e.db"))
        server.start()
        base = f"http://127.0.0.1:{port}"
    try:
        code, bots, tv, restart = asyncio.run(play(base, server))
    finally:
        if server:
            server.stop()
    print("restart:", restart, "dropped:", bots[3].dropped, "days:", bots[0].state["game"]["day"],
          "winner:", bots[0].state["game"]["winner"], bots[0].state["game"]["win_reason"])
    winners = {b.state["game"]["winner"] for b in bots}
    assert len(winners) == 1 and winners <= {"chill", "over"}
    assert bots[3].dropped and bots[3].reconnected_at is not None
    seats = bots[0].state["room"]["seat_ids"]
    assert bots[3].pid in seats  # same seat after reconnecting
    if server:
        assert restart, "restart did not happen mid-game"
        assert restart["all_back"], restart
        assert restart["resume_seconds"] < 10, restart
        assert 1012 in restart["codes"], restart  # server said "service restart"
    check_wire_leaks(bots, tv)
    final = tv.messages[-1]["game"]
    assert final["roles"] and final["winner"] in ("chill", "over")
