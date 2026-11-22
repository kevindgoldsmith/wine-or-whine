"""Room snapshots and the TTS cache, in Postgres (DATABASE_URL) or SQLite (local development).

The interface is synchronous; the server calls it through ``asyncio.to_thread``.
"""
from __future__ import annotations

import logging
import sqlite3
import threading
import time
from pathlib import Path
from typing import Optional, Protocol

log = logging.getLogger("wine.storage")


class Storage(Protocol):
    kind: str

    def init(self) -> None: ...
    def save_room(self, code: str, state: str, version: int, status: str) -> None: ...
    def load_rooms(self) -> list[tuple[str, str, int, str, float]]: ...
    def delete_room(self, code: str) -> None: ...
    def tts_get(self, key: str) -> Optional[tuple[bytes, str]]: ...
    def tts_put(self, key: str, audio: bytes, content_type: str) -> None: ...
    def ping(self) -> bool: ...
    def close(self) -> None: ...


class SQLiteStorage:
    kind = "sqlite"

    def __init__(self, path: str):
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._lock = threading.Lock()

    def init(self) -> None:
        with self._lock, self._db:
            self._db.execute(
                "CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, state TEXT NOT NULL, version INTEGER NOT NULL,"
                " status TEXT NOT NULL, updated_at REAL NOT NULL)"
            )
            self._db.execute(
                "CREATE TABLE IF NOT EXISTS tts_cache (text_hash TEXT PRIMARY KEY, audio BLOB NOT NULL,"
                " content_type TEXT NOT NULL)"
            )

    def save_room(self, code: str, state: str, version: int, status: str) -> None:
        now = time.time()
        with self._lock, self._db:
            cur = self._db.execute(
                "UPDATE rooms SET state=?, version=?, status=?, updated_at=? WHERE code=? AND version=?",
                (state, version, status, now, code, version - 1),
            )
            if cur.rowcount:
                return
            cur = self._db.execute(
                "INSERT INTO rooms (code, state, version, status, updated_at) VALUES (?,?,?,?,?)"
                " ON CONFLICT(code) DO NOTHING",
                (code, state, version, status, now),
            )
            if not cur.rowcount:
                log.warning("snapshot version conflict for a room; overwriting with in-memory state")
                self._db.execute(
                    "UPDATE rooms SET state=?, version=?, status=?, updated_at=? WHERE code=?",
                    (state, version, status, now, code),
                )

    def load_rooms(self) -> list[tuple[str, str, int, str, float]]:
        with self._lock:
            return list(self._db.execute("SELECT code, state, version, status, updated_at FROM rooms"))

    def delete_room(self, code: str) -> None:
        with self._lock, self._db:
            self._db.execute("DELETE FROM rooms WHERE code=?", (code,))

    def tts_get(self, key: str) -> Optional[tuple[bytes, str]]:
        with self._lock:
            row = self._db.execute("SELECT audio, content_type FROM tts_cache WHERE text_hash=?", (key,)).fetchone()
        return (bytes(row[0]), row[1]) if row else None

    def tts_put(self, key: str, audio: bytes, content_type: str) -> None:
        with self._lock, self._db:
            self._db.execute(
                "INSERT INTO tts_cache (text_hash, audio, content_type) VALUES (?,?,?) ON CONFLICT(text_hash) DO NOTHING",
                (key, audio, content_type),
            )

    def ping(self) -> bool:
        with self._lock:
            self._db.execute("SELECT 1").fetchone()
        return True

    def close(self) -> None:
        with self._lock:
            self._db.close()


class PostgresStorage:
    kind = "postgres"

    def __init__(self, url: str):
        from psycopg_pool import ConnectionPool

        self._pool = ConnectionPool(url, min_size=1, max_size=5, open=True, kwargs={"autocommit": True})

    def init(self) -> None:
        with self._pool.connection() as c:
            c.execute(
                "CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, state TEXT NOT NULL, version INTEGER NOT NULL,"
                " status TEXT NOT NULL, updated_at DOUBLE PRECISION NOT NULL)"
            )
            c.execute(
                "CREATE TABLE IF NOT EXISTS tts_cache (text_hash TEXT PRIMARY KEY, audio BYTEA NOT NULL,"
                " content_type TEXT NOT NULL)"
            )

    def save_room(self, code: str, state: str, version: int, status: str) -> None:
        now = time.time()
        with self._pool.connection() as c:
            cur = c.execute(
                "UPDATE rooms SET state=%s, version=%s, status=%s, updated_at=%s WHERE code=%s AND version=%s",
                (state, version, status, now, code, version - 1),
            )
            if cur.rowcount:
                return
            cur = c.execute(
                "INSERT INTO rooms (code, state, version, status, updated_at) VALUES (%s,%s,%s,%s,%s)"
                " ON CONFLICT (code) DO NOTHING",
                (code, state, version, status, now),
            )
            if not cur.rowcount:
                log.warning("snapshot version conflict for a room; overwriting with in-memory state")
                c.execute(
                    "UPDATE rooms SET state=%s, version=%s, status=%s, updated_at=%s WHERE code=%s",
                    (state, version, status, now, code),
                )

    def load_rooms(self) -> list[tuple[str, str, int, str, float]]:
        with self._pool.connection() as c:
            return [tuple(r) for r in c.execute("SELECT code, state, version, status, updated_at FROM rooms")]  # type: ignore[misc]

    def delete_room(self, code: str) -> None:
        with self._pool.connection() as c:
            c.execute("DELETE FROM rooms WHERE code=%s", (code,))

    def tts_get(self, key: str) -> Optional[tuple[bytes, str]]:
        with self._pool.connection() as c:
            row = c.execute("SELECT audio, content_type FROM tts_cache WHERE text_hash=%s", (key,)).fetchone()
        return (bytes(row[0]), row[1]) if row else None

    def tts_put(self, key: str, audio: bytes, content_type: str) -> None:
        with self._pool.connection() as c:
            c.execute(
                "INSERT INTO tts_cache (text_hash, audio, content_type) VALUES (%s,%s,%s) ON CONFLICT (text_hash) DO NOTHING",
                (key, audio, content_type),
            )

    def ping(self) -> bool:
        with self._pool.connection() as c:
            c.execute("SELECT 1").fetchone()
        return True

    def close(self) -> None:
        self._pool.close()


def make_storage(database_url: str, sqlite_path: str) -> Storage:
    if database_url:
        url = database_url
        if url.startswith("postgres://"):
            url = "postgresql://" + url[len("postgres://"):]
        return PostgresStorage(url)
    return SQLiteStorage(sqlite_path)
