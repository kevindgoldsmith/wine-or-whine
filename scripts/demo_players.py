"""Artificial players for watching a demo game on the TV.

    python scripts/demo_players.py https://<site> ROOMCODE [--players 8] [--step 1.0] [--round-pause 5]

Joins N bot phones to an existing room (create it on the TV with "Start a new trip on this TV"), waits for
the host to press Start, then plays the whole game: exactly one action every --step seconds, with a longer
--round-pause after each day ends. Each bot sees only its own phone's view and plays sensibly for its team.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import random
import time

import websockets

NAMES = ["Sarah", "Tom", "Priya", "Jess", "Marco", "Ana", "Dev", "Lena", "Sam", "Kit"]


class DemoBot:
    def __init__(self, name: str, url: str, rng: random.Random):
        self.name, self.url, self.rng = name, url, rng
        self.token = None
        self.state = None
        self.ws = None
        self.updated = asyncio.Event()

    async def run(self):
        delay = 0.5
        while True:
            try:
                async with websockets.connect(self.url) as ws:
                    self.ws = ws
                    delay = 0.5
                    await ws.send(json.dumps({"t": "hello", "kind": "player", "token": self.token}))
                    if self.token is None:
                        await ws.send(json.dumps({"t": "join", "name": self.name}))
                    async for raw in ws:
                        m = json.loads(raw)
                        if m["t"] == "ping":
                            await ws.send('{"t":"pong"}')
                        elif m["t"] == "welcome":
                            self.token = m.get("token", self.token)
                        elif m["t"] == "state":
                            self.state = m
                            self.updated.set()
                        elif m["t"] == "error" and m.get("code") not in ("illegal",):
                            print(f"  [{self.name}] error: {m.get('code')}")
            except (websockets.ConnectionClosed, OSError):
                pass
            await asyncio.sleep(delay)
            delay = min(delay * 2, 5)

    @property
    def game(self):
        return self.state and self.state.get("game")

    def my_turn(self) -> bool:
        g = self.game
        if not g or g["phase"] == "game_over" or g.get("spectator") or self.state["room"]["paused"]:
            return False
        me = g.get("me")
        if g["phase"] == "reveal":
            return me not in g["acked"]
        return me in g["waiting_on"]

    def choose(self) -> dict:
        g, r = self.game, self.rng
        team = "chill" if g["role"] == "chill" else "over"
        known = {int(s): role for s, role in g["known"].items()}
        mates = {s for s, role in known.items() if role != "chill" and s != g["me"]}
        ph = g["phase"]
        if ph == "reveal":
            return {"type": "ack_role"}
        if ph == "nominate":
            pool = g["eligible"]
            friends = [p for p in pool if p in mates]
            return {"type": "nominate", "target": r.choice(friends if friends and r.random() < 0.7 else pool)}
        if ph == "vote":
            pair = {g["president"], g["nominee"]}
            if team == "over":
                yes = bool(pair & (mates | {g["me"]})) or r.random() < 0.4
            else:
                yes = r.random() < (0.45 if g["meter"] < 2 else 0.75)
            return {"type": "vote", "yes": yes}
        if ph in ("pres_discard", "chanc_enact"):
            hand = g["hand"]
            if ph == "chanc_enact" and g["veto_unlocked"] and not g["veto_refused"] and r.random() < 0.15:
                return {"type": "propose_veto"}
            want = "B" if team == "chill" else "O"
            if ph == "pres_discard":  # throw away a card you don't want
                bad = [i for i, c in enumerate(hand) if c != want]
                return {"type": "discard", "index": bad[0] if bad and r.random() < 0.85 else r.randrange(len(hand))}
            good = [i for i, c in enumerate(hand) if c == want]
            return {"type": "enact", "index": good[0] if good and r.random() < 0.85 else r.randrange(len(hand))}
        if ph == "veto_response":
            return {"type": "veto", "accept": r.random() < 0.5}
        if ph == "power":
            targets = g["power_targets"]
            if g["power"] == "execute" and team == "over":
                targets = [t for t in targets if t not in mates] or targets
            return {"type": "power_target", "target": r.choice(targets)}
        if ph == "power_result":
            return {"type": "power_ack"}
        raise RuntimeError(ph)

    async def act(self, a: dict):
        await self.ws.send(json.dumps({"t": "act", "id": f"{self.name}-{time.time()}", "a": a}))


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("base")
    ap.add_argument("code")
    ap.add_argument("--players", type=int, default=8)
    ap.add_argument("--step", type=float, default=1.0)
    ap.add_argument("--round-pause", type=float, default=5.0)
    ap.add_argument("--seed", type=int, default=None)
    args = ap.parse_args()
    rng = random.Random(args.seed)
    url = args.base.rstrip("/").replace("http", "ws", 1) + f"/ws/{args.code.upper()}"
    bots = []
    for i in range(args.players):
        b = DemoBot(NAMES[i], url, random.Random(rng.random()))
        bots.append(b)
        asyncio.create_task(b.run())
        await asyncio.sleep(0.4)  # join one by one so the TV lobby fills up visibly
    print(f"{args.players} players joined room {args.code.upper()}. Waiting for the host to press Start…", flush=True)
    while not (bots[0].game and bots[0].state["room"]["status"] == "active"):
        await asyncio.sleep(0.2)
    print("Game started.", flush=True)
    last_day = 0
    while True:
        await asyncio.sleep(args.step)
        g = bots[0].game
        if g and g["phase"] == "game_over":
            print(f"Game over: {g['winner']} ({g['win_reason']}) on day {g['day']}.", flush=True)
            return
        if g and g["day"] > last_day and g["phase"] == "nominate":
            if last_day:  # a day just ended: let the TV breathe
                print(f"  -- end of day {last_day}, pausing {args.round_pause:g}s", flush=True)
                await asyncio.sleep(args.round_pause)
            last_day = g["day"]
        ready = [b for b in bots if b.my_turn()]
        if not ready:
            continue
        b = rng.choice(ready)
        a = b.choose()
        for x in bots:
            x.updated.clear()
        await b.act(a)
        try:  # wait for the server to apply it before the next action
            await asyncio.wait_for(bots[0].updated.wait(), 5)
        except asyncio.TimeoutError:
            pass
        await asyncio.sleep(0.15)


if __name__ == "__main__":
    asyncio.run(main())
