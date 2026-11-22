# Wine or Whine 🍷👶

A phone-based, self-moderated hidden-role party game for 5–10 players: a private, non-commercial reskin of
*Secret Hitler*, themed around four couples taking their infants on a trip to Napa. Everyone plays on their
own phone (no app, no accounts); the server runs every rule and deals every secret. An optional TV or laptop
shows the public board with animations, sound and voice.

*Adapted from Secret Hitler by Goat, Wolf & Cabbage · CC BY-NC-SA 4.0.*

## How to play (for the group)

1. The host opens the site and taps **Start a new trip**, then enters their name.
2. Everyone else scans the QR code (or opens the link / types the 4-letter code) and enters a name.
3. Optional: open `https://<site>/<CODE>/tv` on a TV or laptop and tap **Tap to start** (turns on sound).
4. The host puts players in seating order (clockwise) and taps **Start the trip**.
5. Each phone says exactly what to do next. Tap **Catch me up** if you looked away.

**Testing on one device:** add `?test` to the URL (e.g. `https://<site>/?test` or `https://<site>/ABCD?test`).
That tab then remembers its seat in per-tab storage, so every `?test` tab or window in the same browser joins
as a separate player (marked "TEST TAB" in the corner). Reloading a test tab keeps its seat; closing it loses
it (use the rejoin code). Without `?test`, all tabs in a browser share one seat, as on a real phone.

Players who switch phones: the host opens **⋯ → Show rejoin codes**, and the player picks their name and enters
their 4-digit code. Phones that lock, reload or drop off Wi-Fi rejoin on their own.

## Local development

Requires Python 3.12 and Node 22.

```bash
python3.12 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
(cd web && npm ci && npm run build)
uvicorn server.main:app --reload          # http://localhost:8000, SQLite in ./data/ when DATABASE_URL is unset
```

For live front-end reloading run `cd web && npm run dev` (Vite on :5173 proxies `/api` and `/ws` to :8000).
Copy `.env.example` to `.env` if you want to set variables locally (`.env` is gitignored).

### Tests

```bash
python -m pytest -q                       # engine, simulations, leak tests, server, e2e
SIM_GAMES=3000 SIM_LEAK_GAMES=300 python -m pytest -q tests/test_simulation.py   # bigger simulation run
TEST_DATABASE_URL=postgresql://... python -m pytest -q tests/test_postgres.py
E2E_DATABASE_URL=postgresql://... python -m pytest -q tests/test_e2e.py           # e2e on Postgres
(cd web && npm test)                      # discreet-mode rendering tests
python scripts/sample_game.py 8 3         # print a sample game transcript in theme words
```

CI (GitHub Actions) runs all of the above on every push, with a Postgres service, plus a Docker build.

## Deploying to Railway

One project, two services: this app and Postgres. Railway builds the `Dockerfile` automatically.
There is deliberately **no `railway.json` / `railway.toml`**: every setting below lives in the dashboard.

1. **Postgres:** in the project, *New → Database → PostgreSQL*.
2. **App service:** an empty service (deployed with `railway up`), or *New → GitHub repo* → this repo with deploy branch **`main`**.
3. **Variables** (app service):

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (reference variable, private network) |
   | `PUBLIC_BASE_URL` | `https://<generated domain>` (used in QR codes) |
   | `TTS_PROVIDER` | `none`, `elevenlabs` or `openai` |
   | `TTS_API_KEY` | provider key (leave empty for `none`) |
   | `TTS_VOICE_ID` | ElevenLabs voice id, or OpenAI voice name (e.g. `alloy`) |

   Railway provides `PORT`; don't set it.
4. **Settings:** health-check path **`/livez`** · restart policy **On failure** · **1 replica** ·
   **Serverless / App Sleeping off** (sleeping drops every WebSocket).
5. **Networking:** *Generate domain*, then put it in `PUBLIC_BASE_URL`.
6. After each deploy, run the smoke test: `python scripts/smoke.py https://<generated domain>`
   (checks `/livez` and `/health`, joins and reconnects 5 WebSocket clients, deletes its test room).

**Current setup:** the service is *not* GitHub-connected; deploys are `railway up` from a Claude session using
a project token stored as a cloud-environment network secret:
`RAILWAY_TOKEN=proxy-injected railway up --service <app service id> --environment <env id> --project <project id> --detach`.
(To deploy on merge instead, connect the repo to the service in the dashboard with deploy branch `main`.)

### Why it survives deploys

The app is a single process with live room state in memory; every accepted action is written to Postgres
before it is broadcast. On SIGTERM (every Railway deploy) the server closes sockets with code 1012 and
flushes snapshots; on start it reloads every room. Phones and the TV reconnect with backoff
(0.5 s → 5 s, jittered), immediately when the screen wakes or the network returns, and resend any action
that wasn't acknowledged (the server de-duplicates by action id). The end-to-end test restarts the server
mid-game and checks every client is back within 10 s (locally it takes under a second).

## Sounds, music and voice

- **Sound effects** play on the TV (phones only make a quiet tap and vibrate). Every slot has a synthesized
  WebAudio placeholder, so nothing needs to be added. To use real files, drop `<slot>.mp3` into
  `static/sfx/` and list the slot in `static/sfx/manifest.json`, e.g. `["vote_pass", "shh"]`.
  Slots: `day_start nominate vote_cast vote_reveal vote_pass vote_fail meter_tick babies_decide shh
  card_breezy card_over power veto babysitter win_chill win_over click`. Free sources: Pixabay sound effects
  (check each file's license).
- **Lobby music:** optional `static/music/lobby.mp3`, looped on the TV lobby. The TV has a mute button.
- **Voice announcements** ("Day 3. Sarah is up first.") are generated server-side by the configured TTS
  provider and cached in Postgres by text hash. With `TTS_PROVIDER=none` the TV uses the browser's built-in
  speech. The host can switch voice off in the lobby or the ⋯ menu.

## Themes

Every player-facing word lives in `themes/wine_or_whine.json`. To add a theme, copy it, change `id`, `name`
and the strings, and drop it in `themes/`; the host can then pick it in the lobby. Power boards live in
`config/boards.json`; the host can override slots under **Advanced → House rules**.

## Layout

```
engine/   pure rules engine (no I/O): state + action → new state + public events; per-recipient views
server/   FastAPI: rooms, WebSockets, message builder, storage (Postgres/SQLite), TTS
web/      Vite + Preact + TypeScript: home, phone and TV clients
themes/   theme strings          config/  power boards
static/   sfx and music slots    tests/   engine, simulation, leak, server, Postgres, e2e
scripts/  sample_game.py, smoke.py
```

See `DECISIONS.md` for judgement calls.
