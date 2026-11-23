"""FastAPI entry point: HTTP API, WebSocket endpoint, static client, health checks."""
from __future__ import annotations

import asyncio
import contextlib
import io
import logging
import re
from typing import Optional

import segno
from fastapi import FastAPI, HTTPException, Request, WebSocket
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from .config import Settings
from .hub import Hub
from .rooms import RoomError, _same, hash_secret
from .storage import make_storage
from .tts import TTS

VERSION = "1.0.0"
CODE_RE = re.compile(r"^[A-Za-z]{4}$")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger("wine")


def _base_from_ws(ws: WebSocket) -> str:
    scheme = "https" if ws.url.scheme in ("wss", "https") else "http"
    return f"{scheme}://{ws.url.netloc}"


def create_app(settings: Optional[Settings] = None, storage=None, tts: Optional[TTS] = None) -> FastAPI:
    settings = settings or Settings()

    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI):
        store = storage or make_storage(settings.database_url, settings.sqlite_path)
        speech = tts or TTS(settings.tts_provider, settings.tts_api_key, settings.tts_voice_id, store)
        hub = Hub(settings, store, speech)
        await hub.load()
        app.state.hub = hub
        log.info("storage=%s tts=%s", store.kind, speech.provider)

        async def every(seconds: float, fn):
            while True:
                await asyncio.sleep(seconds)
                try:
                    await fn()
                except Exception:
                    log.exception("background task failed")

        tasks = [
            asyncio.create_task(every(settings.ping_seconds, hub.ping_all)),
            asyncio.create_task(every(settings.sweep_seconds, hub.sweep)),
        ]
        try:
            yield
        finally:
            for t in tasks:
                t.cancel()
            # On SIGTERM (every Railway deploy): close sockets with 1012 so clients reconnect at once,
            # then flush snapshots (already written after every action; this is belt and braces).
            await hub.close_all(1012, "service restart")
            await hub.flush_all()
            await asyncio.to_thread(store.close)
            log.info("shutdown complete")

    app = FastAPI(title="Wine or Whine", version=VERSION, lifespan=lifespan, docs_url=None, redoc_url=None,
                  openapi_url=None)

    def hub_of(request: Request) -> Hub:
        return request.app.state.hub

    # ------------------------------------------------------------ health
    @app.get("/livez")
    async def livez():
        return {"ok": True}

    @app.get("/health")
    async def health(request: Request):
        hub = hub_of(request)
        try:
            db_ok = await asyncio.to_thread(hub.storage.ping)
        except Exception:
            db_ok = False
        body = {"status": "ok" if db_ok else "degraded", "version": VERSION, "db": hub.storage.kind,
                "active_rooms": hub.active_games(), "rooms": len(hub.rooms)}
        return JSONResponse(body, status_code=200 if db_ok else 503)

    # ------------------------------------------------------------ API
    @app.post("/api/rooms")
    async def create_room(request: Request):
        hub = hub_of(request)
        theme, from_tv = None, False
        with contextlib.suppress(Exception):
            body = await request.json()
            if isinstance(body, dict):
                theme = body.get("theme")
                from_tv = body.get("from") == "tv"
        ip = request.client.host if request.client else "?"
        try:
            room, host_key = hub.create_room(ip, theme, from_tv)
        except RoomError as exc:
            return JSONResponse({"error": exc.code}, status_code=429 if exc.code == "rate_limited" else 503)
        await hub.save(room)
        return {"code": room.code, "host_key": host_key}

    @app.get("/api/rooms/{code}")
    async def room_info(code: str, request: Request):
        room = hub_of(request).rooms.get(code.upper())
        if not room:
            raise HTTPException(404, "room_missing")
        return {"code": room.code, "status": room.status, "theme": room.theme, "players": len(room.players), "test_mode": room.test_mode}

    @app.delete("/api/rooms/{code}")
    async def delete_room(code: str, request: Request):
        """Delete an empty lobby room (used by the post-deploy smoke test). Needs the room's host key."""
        hub = hub_of(request)
        room = hub.rooms.get(code.upper())
        key = request.headers.get("x-host-key", "")
        if not room or not key or not _same(hash_secret(key), room.host_key_hash):
            raise HTTPException(404, "room_missing")
        if room.status == "active":
            raise HTTPException(409, "game in progress")
        await hub.close_room(room.code)
        return {"deleted": room.code}

    @app.get("/api/rooms/{code}/qr.svg")
    async def room_qr(code: str, request: Request):
        hub = hub_of(request)
        room = hub.rooms.get(code.upper())
        if not room:
            raise HTTPException(404, "room_missing")
        url = hub.join_url(room, str(request.base_url))
        # Test mode: the TV asks for a fresh scan id every few seconds. A distinct URL per scan makes iOS
        # Safari open a new tab instead of jumping back to the tab already showing the room.
        scan = request.query_params.get("scan", "")
        if room.test_mode and scan.isalnum() and len(scan) <= 12:
            url = f"{url}?scan={scan}"
        buf = io.BytesIO()
        segno.make(url, error="m").save(buf, kind="svg", scale=8, dark="#2A1E24", light="#FFFFFF", border=2)
        return Response(buf.getvalue(), media_type="image/svg+xml", headers={"Cache-Control": "no-cache"})

    @app.get("/api/themes")
    async def themes(request: Request):
        return [{"id": t["id"], "name": t["name"]} for t in hub_of(request).themes.values()]

    @app.get("/api/themes/{theme_id}")
    async def theme(theme_id: str, request: Request):
        t = hub_of(request).themes.get(theme_id)
        if not t:
            raise HTTPException(404, "no such theme")
        return JSONResponse(t, headers={"Cache-Control": "public, max-age=300"})

    @app.get("/api/boards")
    async def boards(request: Request):
        return hub_of(request).boards

    @app.get("/api/tts/{key}")
    async def tts_audio(key: str, request: Request):
        if not re.fullmatch(r"[0-9a-f]{40}", key):
            raise HTTPException(404)
        got = await hub_of(request).tts.audio(key)
        if not got:
            raise HTTPException(404)
        audio, ctype = got
        return Response(audio, media_type=ctype, headers={"Cache-Control": "public, max-age=86400"})

    # ------------------------------------------------------------ WebSocket
    @app.websocket("/ws/{code}")
    async def ws_endpoint(ws: WebSocket, code: str):
        await ws.app.state.hub.serve(ws, code.upper(), _base_from_ws(ws))

    # ------------------------------------------------------------ static client (registered last)
    dist = settings.web_dist
    if (dist / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")
    if (dist / "fonts").is_dir():
        app.mount("/fonts", StaticFiles(directory=dist / "fonts"), name="fonts")
    for sub in ("sfx", "music"):
        d = settings.static_dir / sub
        if d.is_dir():
            app.mount(f"/{sub}", StaticFiles(directory=d), name=sub)

    def index() -> Response:
        f = dist / "index.html"
        if not f.exists():
            return HTMLResponse("<h1>Wine or Whine</h1><p>Client not built: run <code>npm run build</code> in web/.</p>")
        return FileResponse(f, headers={"Cache-Control": "no-cache"})

    @app.get("/")
    async def root():
        return index()

    @app.get("/{code}")
    async def phone(code: str):
        if not CODE_RE.match(code):
            raise HTTPException(404)
        return index()

    @app.get("/{code}/tv")
    async def tv(code: str):
        if not CODE_RE.match(code):
            raise HTTPException(404)
        return index()

    return app


app = create_app()
