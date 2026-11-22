"""Server-side text-to-speech for TV announcements, cached by text hash.

Only text the server itself announced can be synthesized (``register``), so the endpoint can't be used
to spend the API key on arbitrary text. With TTS_PROVIDER=none the TV uses the browser's speechSynthesis.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
from collections import OrderedDict
from typing import Optional

import httpx

log = logging.getLogger("wine.tts")


class TTS:
    def __init__(self, provider: str, api_key: str, voice_id: str, storage, client: Optional[httpx.AsyncClient] = None):
        self.provider = provider if provider in ("elevenlabs", "openai") and api_key else "none"
        self.api_key = api_key
        self.voice_id = voice_id
        self.storage = storage
        self._client = client
        self._known: OrderedDict[str, str] = OrderedDict()
        self._locks: dict[str, asyncio.Lock] = {}

    @property
    def enabled(self) -> bool:
        return self.provider != "none"

    def key_for(self, text: str) -> str:
        return hashlib.sha256(f"{self.provider}|{self.voice_id}|{text}".encode()).hexdigest()[:40]

    def register(self, text: str) -> str:
        key = self.key_for(text)
        self._known[key] = text
        self._known.move_to_end(key)
        while len(self._known) > 2000:
            self._known.popitem(last=False)
        return key

    async def audio(self, key: str) -> Optional[tuple[bytes, str]]:
        cached = await asyncio.to_thread(self.storage.tts_get, key)
        if cached:
            return cached
        text = self._known.get(key)
        if not text or not self.enabled:
            return None
        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            cached = await asyncio.to_thread(self.storage.tts_get, key)
            if cached:
                return cached
            try:
                audio, ctype = await self._synthesize(text)
            except Exception as exc:  # network or provider error: the TV falls back to speechSynthesis
                log.warning("tts synthesis failed: %s", type(exc).__name__)
                return None
            await asyncio.to_thread(self.storage.tts_put, key, audio, ctype)
            return audio, ctype

    async def _synthesize(self, text: str) -> tuple[bytes, str]:
        client = self._client or httpx.AsyncClient(timeout=15)
        try:
            if self.provider == "elevenlabs":
                voice = self.voice_id or "21m00Tcm4TlvDq8ikWAM"
                r = await client.post(
                    f"https://api.elevenlabs.io/v1/text-to-speech/{voice}",
                    headers={"xi-api-key": self.api_key, "accept": "audio/mpeg"},
                    json={"text": text, "model_id": "eleven_multilingual_v2"},
                )
            else:
                r = await client.post(
                    "https://api.openai.com/v1/audio/speech",
                    headers={"Authorization": f"Bearer {self.api_key}"},
                    json={"model": "gpt-4o-mini-tts", "voice": self.voice_id or "alloy", "input": text,
                          "response_format": "mp3"},
                )
            r.raise_for_status()
            return r.content, r.headers.get("content-type", "audio/mpeg").split(";")[0]
        finally:
            if self._client is None:
                await client.aclose()
