"""Post-deploy smoke test: python scripts/smoke.py https://your-app.up.railway.app

Checks /livez and /health, creates a room, joins 5 WebSocket clients, drops and reconnects each one with
its seat token, then deletes the test room. Exits non-zero on any failure.
"""
import asyncio
import json
import sys

import httpx
import websockets


async def main(base: str) -> None:
    base = base.rstrip("/")
    async with httpx.AsyncClient(base_url=base, timeout=15) as http:
        for path in ("/livez", "/health"):
            r = await http.get(path)
            print(f"{path}: {r.status_code} {r.text[:120]}")
            assert r.status_code == 200, path
        room = (await http.post("/api/rooms")).json()
        code, key = room["code"], room["host_key"]
        print("room", code)
        ws_url = base.replace("http", "ws", 1) + f"/ws/{code}"
        tokens = {}
        try:
            for i in range(5):
                async with websockets.connect(ws_url) as ws:
                    await ws.send(json.dumps({"t": "hello", "kind": "player"}))
                    await ws.send(json.dumps({"t": "join", "name": f"Smoke{i}", "host_key": key if i == 0 else None}))
                    while True:
                        m = json.loads(await asyncio.wait_for(ws.recv(), 10))
                        if m["t"] == "welcome":
                            tokens[m["player_id"]] = m["token"]
                            break
                        assert m["t"] != "error", m
            print("joined", len(tokens))
            for pid, token in tokens.items():  # reconnect each seat with its token
                async with websockets.connect(ws_url) as ws:
                    await ws.send(json.dumps({"t": "hello", "kind": "player", "token": token}))
                    m = json.loads(await asyncio.wait_for(ws.recv(), 10))
                    assert m["t"] == "welcome" and m["player_id"] == pid, m
            print("reconnected", len(tokens))
        finally:
            r = await http.delete(f"/api/rooms/{code}", headers={"x-host-key": key})
            print("deleted test room:", r.status_code)
    print("SMOKE OK")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000"))
