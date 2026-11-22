"""FastAPI entry point (milestone 0 skeleton)."""
from fastapi import FastAPI

VERSION = "0.0.1"
app = FastAPI(title="Wine or Whine")


@app.get("/livez")
def livez():
    return {"ok": True}


@app.get("/health")
def health():
    return {"status": "ok", "version": VERSION, "active_rooms": 0}
