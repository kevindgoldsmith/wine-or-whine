"""Settings from environment variables (see .env.example)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


@dataclass
class Settings:
    database_url: str = field(default_factory=lambda: _env("DATABASE_URL"))
    sqlite_path: str = field(default_factory=lambda: _env("SQLITE_PATH", str(ROOT / "data" / "wine.db")))
    public_base_url: str = field(default_factory=lambda: _env("PUBLIC_BASE_URL").rstrip("/"))
    tts_provider: str = field(default_factory=lambda: _env("TTS_PROVIDER", "none").lower() or "none")
    tts_api_key: str = field(default_factory=lambda: _env("TTS_API_KEY"))
    tts_voice_id: str = field(default_factory=lambda: _env("TTS_VOICE_ID"))
    max_rooms: int = field(default_factory=lambda: int(_env("MAX_ROOMS", "300")))
    room_creates_per_hour: int = field(default_factory=lambda: int(_env("ROOM_CREATES_PER_HOUR", "30")))
    ping_seconds: float = field(default_factory=lambda: float(_env("PING_SECONDS", "20")))
    sweep_seconds: float = field(default_factory=lambda: float(_env("SWEEP_SECONDS", "600")))
    idle_expiry_hours: float = 12.0
    active_expiry_hours: float = 24.0 * 7
    max_message_bytes: int = 8192
    web_dist: Path = ROOT / "web" / "dist"
    static_dir: Path = ROOT / "static"
    themes_dir: Path = ROOT / "themes"
    boards_path: Path = ROOT / "config" / "boards.json"
