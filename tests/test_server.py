"""Server tests: rooms, seats, rejoin, host controls, idempotency, persistence, views, TTS, logs."""
from __future__ import annotations

import asyncio
import json
import logging
import time

import httpx
import pytest
from fastapi.testclient import TestClient

from engine.boards import load_boards
from server.config import Settings
from server.main import create_app
from server.rooms import Room, RoomError, hash_secret
from server.storage import SQLiteStorage
from server.theme import load_themes
from server.tts import TTS
from server.views import message

BOARDS = load_boards()


def make_settings(tmp_path, **kw) -> Settings:
    s = Settings()
    s.database_url = ""
    s.sqlite_path = str(tmp_path / "test.db")
    s.public_base_url = "https://wine.example"
    s.tts_provider = "none"
    for k, v in kw.items():
        setattr(s, k, v)
    return s


OPEN: list = []


@pytest.fixture(autouse=True)
def _close_phones():
    yield
    close_all_phones()


def close_all_phones():
    while OPEN:
        p = OPEN.pop()
        try:
            p.close()
        except Exception:
            pass


@pytest.fixture
def client(tmp_path):
    app = create_app(make_settings(tmp_path))
    with TestClient(app) as c:
        yield c
        close_all_phones()


class Phone:
    """A test phone over the TestClient websocket."""

    def __init__(self, client: TestClient, code: str):
        self.client, self.code = client, code
        self.ws = client.websocket_connect(f"/ws/{code}").__enter__()
        self.closed = False
        OPEN.append(self)
        self.token = None
        self.pid = None
        self.state = None

    def send(self, **msg):
        self.ws.send_text(json.dumps(msg))

    def recv(self):
        m = json.loads(self.ws.receive_text())
        if m["t"] == "state":
            self.state = m
        if m["t"] == "welcome":
            self.pid = m["player_id"]
            self.token = m.get("token", self.token)
        return m

    def recv_until(self, t, pred=lambda m: True, limit=50):
        for _ in range(limit):
            m = self.recv()
            if m["t"] == t and pred(m):
                return m
        raise AssertionError(f"no {t}")

    def wait_state(self, pred=lambda m: True, limit=50):
        if self.state is not None and pred(self.state):
            return self.state
        return self.recv_until("state", pred, limit)

    def close(self):
        if not self.closed:
            self.closed = True
            self.ws.__exit__(None, None, None)


def new_room(client):
    r = client.post("/api/rooms").json()
    return r["code"], r["host_key"]


def join(client, code, name, host_key=None):
    p = Phone(client, code)
    p.send(t="hello", kind="player")
    p.recv_until("state")
    p.send(t="join", name=name, host_key=host_key)
    p.recv_until("welcome")
    p.wait_state(lambda m: "me" in m)
    return p


def drain(phones):
    for p in phones:
        p.wait_state(lambda m: True)


# ---------------------------------------------------------------- HTTP

def test_health_and_livez(client):
    assert client.get("/livez").json() == {"ok": True}
    h = client.get("/health").json()
    assert h["status"] == "ok" and h["version"] and "active_rooms" in h


def test_room_codes_unambiguous_and_info(client):
    for _ in range(20):
        code, _ = new_room(client)
        assert len(code) == 4 and not set(code) & set("ILO0123456789")
    assert client.get(f"/api/rooms/{code}").json()["status"] == "lobby"
    assert client.get("/api/rooms/ZZZZ").status_code == 404


def test_room_creation_rate_limit(tmp_path):
    app = create_app(make_settings(tmp_path, room_creates_per_hour=3))
    with TestClient(app) as c:
        assert all(c.post("/api/rooms").status_code == 200 for _ in range(3))
        assert c.post("/api/rooms").status_code == 429


def test_max_rooms_cap(tmp_path):
    app = create_app(make_settings(tmp_path, max_rooms=2))
    with TestClient(app) as c:
        c.post("/api/rooms"), c.post("/api/rooms")
        assert c.post("/api/rooms").status_code == 503


def test_qr_and_themes_and_spa_routes(client):
    code, _ = new_room(client)
    svg = client.get(f"/api/rooms/{code}/qr.svg")
    assert svg.status_code == 200 and svg.text.lstrip().startswith("<?xml")
    assert client.get("/api/themes").json()[0]["id"] == "wine_or_whine"
    assert client.get("/api/themes/wine_or_whine").json()["terms"]["president"] == "First One Awake"
    assert client.get(f"/{code}").status_code == 200
    assert client.get(f"/{code}/tv").status_code == 200
    assert client.get("/toolong").status_code == 404
    assert client.get("/api/boards").json()["official"]["5-6"][2] == "peek"


def test_delete_room_needs_host_key(client):
    code, key = new_room(client)
    assert client.delete(f"/api/rooms/{code}").status_code == 404
    assert client.delete(f"/api/rooms/{code}", headers={"x-host-key": "nope"}).status_code == 404
    assert client.delete(f"/api/rooms/{code}", headers={"x-host-key": key}).status_code == 200
    assert client.get(f"/api/rooms/{code}").status_code == 404


# ---------------------------------------------------------------- seats and rejoin

def test_join_host_and_unique_names(client):
    code, key = new_room(client)
    host = join(client, code, "Sarah", key)
    assert host.state["me"]["host"] is True
    other = join(client, code, "Tom")
    assert other.state["me"]["host"] is False
    dup = Phone(client, code)
    dup.send(t="hello", kind="player")
    dup.recv_until("state")
    dup.send(t="join", name="  sarah ")
    assert dup.recv_until("error")["code"] == "name_taken"


def test_typing_existing_name_never_grants_seat_and_token_resumes(client):
    code, key = new_room(client)
    sarah = join(client, code, "Sarah", key)
    token, pid = sarah.token, sarah.pid
    sarah.close()
    # Same name from another phone: refused.
    impostor = Phone(client, code)
    impostor.send(t="hello", kind="player")
    impostor.recv_until("state")
    impostor.send(t="join", name="Sarah")
    assert impostor.recv_until("error")["code"] == "name_taken"
    # The real phone resumes with its token.
    back = Phone(client, code)
    back.send(t="hello", kind="player", token=token)
    assert back.recv_until("welcome")["player_id"] == pid
    assert back.recv_until("state")["me"]["id"] == pid
    # A wrong token is just a guest.
    guest = Phone(client, code)
    guest.send(t="hello", kind="player", token="x" * 32)
    assert guest.recv_until("error")["code"] == "bad_token"


def test_rejoin_code_rotates_token_and_rate_limits():
    room = Room(code="ABCD", host_key_hash=hash_secret("k"))
    p, tok = room.join("Sarah", "k")
    with pytest.raises(RoomError):
        room.rejoin(p.id, "9999" if p.rejoin != "9999" else "0000")
    p2, tok2 = room.rejoin(p.id, p.rejoin)
    assert p2 is p and tok2 != tok
    assert room.by_token(tok) is None and room.by_token(tok2) is p
    now = time.time()
    for _ in range(8):
        with pytest.raises(RoomError):
            room.rejoin(p.id, "abcd", now=now)
    with pytest.raises(RoomError) as e:
        room.rejoin(p.id, p.rejoin, now=now)
    assert e.value.code == "rate_limited"


def test_host_codes_reorder_kick(client):
    code, key = new_room(client)
    host = join(client, code, "Host", key)
    a = join(client, code, "A")
    b = join(client, code, "B")
    a.send(t="host", id="x1", a={"type": "rejoin_codes"})
    assert a.recv_until("error")["code"] == "not_host"
    host.send(t="host", id="h1", a={"type": "rejoin_codes"})
    codes = host.recv_until("rejoin_codes")["codes"]
    assert len(codes) == 3 and all(len(c["code"]) == 4 for c in codes)
    ids = [p["id"] for p in host.state["room"]["players"]]
    host.send(t="host", id="h2", a={"type": "reorder", "order": ids[::-1]})
    st = host.wait_state(lambda m: [p["id"] for p in m["room"]["players"]] == ids[::-1])
    assert st
    host.send(t="host", id="h3", a={"type": "kick", "player_id": b.pid})
    assert b.recv_until("kicked")
    host.wait_state(lambda m: len(m["room"]["players"]) == 2)


# ---------------------------------------------------------------- game over the wire

def start_game(client, n=5):
    code, key = new_room(client)
    phones = [join(client, code, "P0", key)] + [join(client, code, f"P{i}") for i in range(1, n)]
    phones[0].send(t="host", id="start", a={"type": "start"})
    for p in phones:
        p.wait_state(lambda m: m["game"] is not None)
    return code, phones


def test_start_requires_five(client):
    code, key = new_room(client)
    host = join(client, code, "Host", key)
    host.send(t="host", id="s", a={"type": "start"})
    assert host.recv_until("error")["code"] == "need_players"


def test_idempotent_actions_and_pause(client):
    code, phones = start_game(client)
    for p in phones:
        p.send(t="act", id=f"ack-{p.pid}", a={"type": "ack_role"})
        p.recv_until("ack")
    # The same id again is a harmless duplicate.
    phones[0].send(t="act", id=f"ack-{phones[0].pid}", a={"type": "ack_role"})
    assert phones[0].recv_until("ack")["dup"] is True
    st = phones[0].wait_state(lambda m: m["game"]["phase"] == "nominate")
    g = st["game"]
    pres = phones[g["president"]]
    # Pause freezes prompts.
    phones[0].send(t="host", id="pause", a={"type": "pause"})
    pres.wait_state(lambda m: m["room"]["paused"])
    pres.send(t="act", id="nom1", a={"type": "nominate", "target": g["eligible"][0]})
    assert pres.recv_until("error")["code"] == "paused"
    phones[0].send(t="host", id="resume", a={"type": "resume"})
    pres.wait_state(lambda m: not m["room"]["paused"])
    pres.send(t="act", id="nom2", a={"type": "nominate", "target": g["eligible"][0]})
    pres.recv_until("ack")
    pres.send(t="act", id="nom2", a={"type": "nominate", "target": g["eligible"][0]})
    assert pres.recv_until("ack")["dup"] is True
    # Illegal: wrong player nominating is rejected.
    other = phones[(g["president"] + 1) % 5]
    other.send(t="act", id="bad", a={"type": "vote", "yes": "maybe"})
    assert other.recv_until("error")["code"] == "illegal"


def test_messages_are_per_recipient(client):
    code, phones = start_game(client)
    tv = Phone(client, code)
    tv.send(t="hello", kind="tv")
    tvs = tv.recv_until("state")
    assert tvs["game"]["roles"] is None and "role" not in tvs["game"] and "known" not in tvs["game"]
    for p in phones:
        g = p.state["game"]
        assert g["me"] == p.state["room"]["seat_ids"].index(p.pid)
        assert str(g["me"]) in g["known"]
        if g["role"] == "chill":
            assert list(g["known"]) == [str(g["me"])]


def test_room_message_view_shapes():
    room = Room(code="ABCD", host_key_hash=hash_secret("k"))
    for i in range(6):
        room.join(f"P{i}", "k" if i == 0 else None)
    room.host_action(room.host_id, {"type": "start"}, BOARDS, load_themes_dir())
    tv = message(room, "tv", None, set(), "u")
    assert tv["game"]["roles"] is None
    blob = json.dumps(tv)
    for p in room.players:
        assert p.token_hash not in blob and p.rejoin not in blob.replace('"code":"ABCD"', "")
    guest = message(room, "guest", None, set(), "u")
    assert guest["game"] is None


def load_themes_dir():
    from server.config import ROOT

    return load_themes(ROOT / "themes")


# ---------------------------------------------------------------- persistence

def test_snapshot_restore_resumes_game(tmp_path):
    settings = make_settings(tmp_path)
    with TestClient(create_app(settings)) as c:
        code, phones = start_game(c)
        tokens = {p.pid: p.token for p in phones}
        for p in phones:
            p.send(t="act", id=f"a{p.pid}", a={"type": "ack_role"})
            p.recv_until("ack")
        before = phones[0].wait_state(lambda m: m["game"]["phase"] == "nominate")["game"]
        close_all_phones()
    # "Restart": a brand-new app on the same database.
    with TestClient(create_app(settings)) as c2:
        p = Phone(c2, code)
        pid = phones[0].pid
        p.send(t="hello", kind="player", token=tokens[pid])
        p.recv_until("welcome")
        after = p.recv_until("state")["game"]
        assert after["phase"] == "nominate" and after["president"] == before["president"]
        assert after["role"] == before["role"]
        assert c2.get("/health").json()["active_rooms"] == 1
        close_all_phones()


def test_sweeper_expiry(tmp_path):
    settings = make_settings(tmp_path)
    with TestClient(create_app(settings)) as c:
        hub = c.app.state.hub
        lobby_code, _ = new_room(c)
        code, phones = start_game(c)
        for p in phones:
            p.close()
        now = time.time() + 13 * 3600
        removed = asyncio.run(hub.sweep(now))
        assert removed == 1 and lobby_code not in hub.rooms and code in hub.rooms
        assert asyncio.run(hub.sweep(time.time() + 8 * 24 * 3600)) == 1
        close_all_phones()


def test_sqlite_version_check(tmp_path):
    s = SQLiteStorage(str(tmp_path / "v.db"))
    s.init()
    s.save_room("ABCD", "{}", 1, "lobby")
    s.save_room("ABCD", '{"a":1}', 2, "lobby")
    s.save_room("ABCD", '{"a":2}', 2, "lobby")  # stale version: logged, still written (memory is authoritative)
    rows = s.load_rooms()
    assert rows[0][0] == "ABCD" and rows[0][2] == 2


def test_message_size_limit(client):
    code, key = new_room(client)
    p = Phone(client, code)
    p.send(t="hello", kind="player")
    p.recv_until("state")
    p.ws.send_text(json.dumps({"t": "join", "name": "x" * 10000}))
    assert p.recv_until("error")["code"] == "too_big"


# ---------------------------------------------------------------- TTS (mocked HTTP)

def test_tts_only_synthesizes_announced_text_and_caches(tmp_path):
    calls = []

    def handler(request: httpx.Request):
        calls.append(request)
        return httpx.Response(200, content=b"ID3fake", headers={"content-type": "audio/mpeg"})

    store = SQLiteStorage(str(tmp_path / "t.db"))
    store.init()
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    tts = TTS("elevenlabs", "secret-key", "voice1", store, client=client)
    key = tts.register("Day 3. Sarah is up first.")

    async def go():
        assert await tts.audio("0" * 40) is None  # never announced: refused
        a = await tts.audio(key)
        b = await tts.audio(key)
        return a, b

    a, b = asyncio.run(go())
    assert a == (b"ID3fake", "audio/mpeg") and b == a
    assert len(calls) == 1
    assert calls[0].url.host == "api.elevenlabs.io" and calls[0].headers["xi-api-key"] == "secret-key"
    assert json.loads(calls[0].content)["text"] == "Day 3. Sarah is up first."


def test_tts_openai_payload_and_failure_fallback(tmp_path):
    def handler(request):
        if request.url.host == "api.openai.com":
            return httpx.Response(500)
        return httpx.Response(404)

    store = SQLiteStorage(str(tmp_path / "t.db"))
    store.init()
    tts = TTS("openai", "k", "", store, client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    key = tts.register("The vote passes.")
    assert asyncio.run(tts.audio(key)) is None  # provider error: TV falls back to speechSynthesis
    assert TTS("openai", "", "", store).enabled is False  # no key: disabled


def test_tv_gets_announcements_without_tts_url(client):
    code, phones = start_game(client)
    tv = Phone(client, code)
    tv.send(t="hello", kind="tv")
    tv.recv_until("state")
    for p in phones:
        p.send(t="act", id=f"r{p.pid}", a={"type": "ack_role"})
    st = tv.wait_state(lambda m: any(e["type"] == "day_start" for e in m["events"]))
    assert st["say"] and "url" not in st["say"][0] and "up first" in st["say"][0]["text"]
    for p in phones:  # phones never get announcements
        m = p.wait_state(lambda m: m["game"]["phase"] == "nominate")
        assert "say" not in m


# ---------------------------------------------------------------- logs are not a leak path

def test_logs_never_contain_secrets(client, caplog):
    caplog.set_level(logging.DEBUG)
    code, phones = start_game(client)
    host = phones[0]
    host.send(t="host", id="codes", a={"type": "rejoin_codes"})
    codes = host.recv_until("rejoin_codes")["codes"]
    for p in phones:
        p.send(t="act", id=f"a{p.pid}", a={"type": "ack_role"})
    st = host.wait_state(lambda m: m["game"]["phase"] == "nominate")
    # Some rejected actions, which are logged.
    for p in phones:
        p.send(t="act", id=f"bad{p.pid}", a={"type": "discard", "index": 0})
        p.recv_until("error")
    text = caplog.text
    assert "rejected action" in text
    for p in phones:
        assert p.token not in text
    for c in codes:
        assert f"={c['code']}" not in text and f" {c['code']} " not in text
    for word in ("chief", "chill", "'over'", "hand=", "votes", "team"):
        assert word not in text


# ---------------------------------------------------------------- rooms created from the TV

def tv_room(client):
    r = client.post("/api/rooms", json={"from": "tv"}).json()
    tv = Phone(client, r["code"])
    tv.send(t="hello", kind="tv", host_key=r["host_key"])
    tv.recv_until("state")
    return r, tv


def test_tv_created_room_tv_is_host(client):
    r, tv = tv_room(client)
    assert tv.state["room"]["host_id"] == "tv" and tv.state["tv_admin"] is True
    phones = [join(client, r["code"], f"P{i}") for i in range(5)]
    assert not any(p.state["me"]["host"] for p in phones)  # nobody auto-hosts
    # Phones can't use host controls...
    phones[0].send(t="host", id="x", a={"type": "start"})
    assert phones[0].recv_until("error")["code"] == "not_host"
    # ...the TV can: reorder, then start.
    ids = [p["id"] for p in tv.wait_state(lambda m: len(m["room"]["players"]) == 5)["room"]["players"]]
    tv.send(t="host", id="h1", a={"type": "reorder", "order": ids[::-1]})
    tv.recv_until("ack")
    tv.send(t="host", id="h2", a={"type": "start"})
    tv.recv_until("ack")
    st = tv.wait_state(lambda m: m["game"] is not None)
    assert st["room"]["seat_ids"] == ids[::-1]
    # The TV can't play: it has no seat.
    tv.send(t="act", id="h3", a={"type": "ack_role"})
    assert tv.recv_until("error")["code"] == "not_joined"
    # Pause from the TV.
    tv.send(t="host", id="h4", a={"type": "pause"})
    assert tv.recv_until("ack")
    assert phones[0].wait_state(lambda m: m["room"]["paused"])


def test_tv_hands_hosting_to_a_phone_and_takes_it_back(client):
    r, tv = tv_room(client)
    a, b = join(client, r["code"], "Ann"), join(client, r["code"], "Ben")
    tv.send(t="host", id="m1", a={"type": "make_host", "player_id": a.pid})
    tv.recv_until("ack")
    assert a.wait_state(lambda m: m["me"]["host"])["room"]["host_id"] == a.pid
    # While a phone hosts, the TV can't run other host controls...
    tv.send(t="host", id="m2", a={"type": "kick", "player_id": b.pid})
    assert tv.recv_until("error")["code"] == "not_host"
    # ...but it owns the room, so it can move hosting again or take it back.
    tv.send(t="host", id="m3", a={"type": "make_host", "player_id": b.pid})
    tv.recv_until("ack")
    assert b.wait_state(lambda m: m["me"]["host"])
    b.send(t="host", id="m4", a={"type": "make_host", "player_id": "tv"})  # phone hands back to the TV
    b.recv_until("ack")
    assert tv.wait_state(lambda m: m["room"]["host_id"] == "tv")


def test_tv_reveals_one_rejoin_code_at_a_time(client):
    r, tv = tv_room(client)
    a = join(client, r["code"], "Ann")
    tv.send(t="host", id="c1", a={"type": "rejoin_codes"})
    assert tv.recv_until("error")["code"] == "not_host"  # never the whole list on a shared screen
    tv.send(t="host", id="c2", a={"type": "rejoin_code", "player_id": a.pid})
    got = tv.recv_until("rejoin_code")
    assert got["name"] == "Ann" and len(got["code"]) == 4


def test_tv_without_the_host_key_has_no_powers(client):
    r, owner = tv_room(client)
    spy = Phone(client, r["code"])
    spy.send(t="hello", kind="tv")  # typed the code, no key
    st = spy.recv_until("state")
    assert st["tv_admin"] is False
    spy.send(t="host", id="s1", a={"type": "make_host", "player_id": "tv"})
    assert spy.recv_until("error")["code"] == "not_joined"
    wrong = Phone(client, r["code"])
    wrong.send(t="hello", kind="tv", host_key="guess")
    assert wrong.recv_until("error")["code"] == "not_host"
    # A TV for a phone-created room never gets powers, even with that room's host key.
    code, key = new_room(client)
    tv2 = Phone(client, code)
    tv2.send(t="hello", kind="tv", host_key=key)
    assert tv2.recv_until("state")["tv_admin"] is False


def test_phone_created_room_still_needs_the_host_key(client):
    code, key = new_room(client)
    stranger = join(client, code, "Stranger")
    assert stranger.state["me"]["host"] is False
    owner = join(client, code, "Owner", key)
    assert owner.state["me"]["host"] is True
    owner.send(t="host", id="x", a={"type": "make_host", "player_id": "tv"})
    assert owner.recv_until("error")["code"] == "bad_request"  # no TV host in a phone-created room


def test_tv_host_survives_restart(tmp_path):
    settings = make_settings(tmp_path)
    with TestClient(create_app(settings)) as c:
        r, tv = tv_room(c)
        close_all_phones()
    with TestClient(create_app(settings)) as c2:
        tv = Phone(c2, r["code"])
        tv.send(t="hello", kind="tv", host_key=r["host_key"])
        st = tv.recv_until("state")
        assert st["tv_admin"] is True and st["room"]["host_id"] == "tv"
        close_all_phones()


def test_host_can_toggle_test_mode():
    from server.rooms import Room, RoomError
    r = Room(code="TEST", host_key_hash="x")
    r.players = []
    r.host_id = "h"
    r.host_action("h", {"type": "settings", "test_mode": True}, {"official": {}}, {})
    assert r.test_mode is True
    assert Room.from_dict(r.to_dict()).test_mode is True
    try:
        r.host_action("h", {"type": "settings", "test_mode": "yes"}, {"official": {}}, {})
        assert False, "non-bool accepted"
    except RoomError:
        pass
