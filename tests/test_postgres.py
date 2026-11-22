"""Postgres backend tests. Run with TEST_DATABASE_URL=postgresql://... (CI provides a Postgres service)."""
import os
import secrets

import pytest

from server.storage import PostgresStorage, make_storage

URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL not set")


@pytest.fixture
def store():
    s = make_storage(URL, "")
    assert isinstance(s, PostgresStorage)
    s.init()
    s.init()  # CREATE TABLE IF NOT EXISTS is idempotent
    yield s
    s.close()


def test_room_snapshots_with_version_check(store):
    code = "T" + secrets.token_hex(2).upper()
    store.save_room(code, '{"v":1}', 1, "lobby")
    store.save_room(code, '{"v":2}', 2, "active")
    store.save_room(code, '{"v":3}', 2, "active")  # stale version is logged and overwritten
    row = next(r for r in store.load_rooms() if r[0] == code)
    assert row[1] == '{"v":3}' and row[2] == 2 and row[3] == "active"
    store.delete_room(code)
    assert all(r[0] != code for r in store.load_rooms())


def test_tts_cache_bytes(store):
    key = secrets.token_hex(20)
    assert store.tts_get(key) is None
    store.tts_put(key, b"\x00\x01ID3", "audio/mpeg")
    store.tts_put(key, b"other", "audio/mpeg")  # first write wins
    assert store.tts_get(key) == (b"\x00\x01ID3", "audio/mpeg")
    assert store.ping()


def test_postgres_scheme_alias():
    s = make_storage(URL.replace("postgresql://", "postgres://", 1), "")
    assert s.ping()
    s.close()
