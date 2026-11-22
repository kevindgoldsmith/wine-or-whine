# Wine or Whine — working agreement

A phone-based, self-moderated hidden-role party game (a private, non-commercial reskin of Secret Hitler,
CC BY-NC-SA 4.0). Standalone project: never reference, import or copy anything from other projects.

- Commit and push at the end of each milestone.
- **Ask Kevin before every deploy and every Railway change** (variables, settings, databases, domains).
- If GitHub refuses the push of `.github/workflows/ci.yml`, tell Kevin instead of working around it.
- Record every judgement call in `DECISIONS.md`.
- Never print, log or commit secrets (`RAILWAY_TOKEN`, `TTS_API_KEY`). `.env` is gitignored.
- No `railway.json` / `railway.toml`; Railway settings live in the dashboard and are listed in the README.
- Never log seat tokens, rejoin codes, roles, hands, unrevealed votes or power results.

## Layout
- `engine/` pure rules engine, no I/O (state in, action in → new state + public events out)
- `server/` FastAPI app: rooms, WebSockets, views, storage, TTS
- `web/` Vite + Preact + TypeScript phone and TV clients
- `themes/` all player-facing strings; `config/boards.json` power boards

## Commands
- `pip install -r requirements-dev.txt` then `python -m pytest -q` (set `SIM_GAMES` to scale simulations)
- `cd web && npm ci && npm test && npm run build`
- Run locally: `uvicorn server.main:app --reload` (SQLite in `./data/` when `DATABASE_URL` is unset)
