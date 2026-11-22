# Decisions

Judgement calls made while building, newest at the bottom of each section.

## Infrastructure
- **Single process, single replica, one uvicorn worker.** Live room state is held in memory and is
  authoritative; the Postgres snapshot written after every accepted action exists for restart recovery only.
  Scaling out would need a shared pub/sub and is out of scope.
- **No `railway.json` / `railway.toml`.** Service settings live in the Railway dashboard and are listed in the README.
- **Deploy path: `railway up` from a Claude session (Kevin's choice, 2026-11-22).** The project token is saved
  as a network secret on the `kg-personal` cloud environment (header `Project-Access-Token`), never in the repo
  or an env var. The service is not GitHub-connected, so pushing to `main` does not deploy. Connecting the repo
  in the dashboard later would switch to merge-to-deploy.
- **Railway layout:** project "focused-laughter" (a project token can't rename it; rename in the dashboard),
  environment `production`, services `Postgres` (official template) and `wine-or-whine`
  (https://wine-or-whine-production.up.railway.app). Voice: `TTS_PROVIDER=none` (browser speech) for now.

## Rules engine
- **Role reveal is a real phase.** The first day starts only once every player has tapped "Got it", so nobody
  is prompted while others are still reading their card.
- **Each nomination round is a "day".** Failed votes also advance the day counter, so "Day N" always matches
  one First One Up turn.
- **Powers with a private result (read a phone, check the nap schedule) wait for the First One Up to tap
  "Done"**, so the result screen isn't yanked away by the next day starting.
- **House rules allow at most 2 babysitter-duty slots.** More could leave fewer than 3 players, where
  nominations can deadlock. The official boards have exactly 2.
- **Card identities are never public except when played.** Discards (including vetoed cards) are face down;
  only counts are shown.
- **Superlative ties list every tied player.**

## Server and phones
- **The host is a phone player.** "Start a new trip" creates the room and a one-time host key kept in that
  browser; the first player to join with it becomes host. The host can hand the role to someone else.
- **Rejoin with the 4-digit code rotates the seat token**, signing out any other phone that held the seat.
  Failed codes are rate-limited per room (8 per 10 minutes) so the 10,000 codes can't be brute-forced.
- **Seat tokens and the host key are stored hashed** in snapshots.
- **Abandoned games expire after 7 days of inactivity** (lobbies and finished games after 12 hours). The brief
  says active games never expire; a week-long cap stops dead rooms filling the room limit forever.
- **Limits:** 300 live rooms, 30 room creations per IP per hour, 8 KB per WebSocket message, 40 messages per
  10 s per socket. Configurable by env var (`MAX_ROOMS`, `ROOM_CREATES_PER_HOUR`).
- **Every accepted change is saved before it is broadcast or acknowledged**, so an acknowledged action is never
  lost on restart. Clients resend unacknowledged actions after reconnecting; the server de-duplicates by
  action id (the last 300 ids are part of the snapshot).
- **Keepalive** is an app-level `{"t":"ping"}` every 20 s (browsers can't see protocol pings); a client that
  hears nothing for 45 s reconnects. uvicorn's protocol-level pings stay on to reap dead sockets server-side.
- **TTS only speaks text the server announced** (registered by hash), so `/api/tts/{hash}` can't be used to
  spend the API key on arbitrary text.
- **Rules hints** are on for the first game; "Play again" turns them off unless the host ticks the box.
- **Discreet mode also strips emoji from choice text** (e.g. "😴 Sleeping in" becomes "Sleeping in").
- **The host menu (⋯)** holds pause/resume, rejoin codes and the voice toggle during a game.

## TV board
- **Beats never block the game and never lag far behind.** If events pile up, beats play faster and only the
  newest six are kept; at game over the TV skips straight to the ending.
- **The TV shows a persistent 🤫 on the table** while cards are with the government, plus a full-screen "Shh"
  beat when the handoff starts.
- **Superlatives appear on the TV and on every phone** at game over.

## Audio and polish
- **Phones never speak or play announcements**; they only make a quiet tap and a short vibration.
- **Placeholder sound effects are synthesized in the browser**, so `static/sfx/` ships empty except for a
  `manifest.json` listing which real files exist (avoids 404 probes for every slot).
- **The Docker `CMD` uses `exec`** (still shell form, so `$PORT` expands) so uvicorn is PID 1 and receives
  Railway's SIGTERM; otherwise `/bin/sh` swallows it and the graceful 1012 close never happens.
- **`scripts/smoke.py`** is the post-deploy smoke test; `DELETE /api/rooms/{code}` (host key required, never an
  active game) lets it clean up its test room.
- **Verified on Railway (2026-11-22):** redeploying mid-game (8 phones + TV, Day 3, mid-vote). Railway kept the
  old container serving until the new one passed `/livez` (~33 s), then the old one closed every socket with
  1012. All 8 phones and the TV were back on the new container within 1.03 s, in the same day and phase, and
  the game played on to the end.

## Testing aids
- **`?test` makes a tab its own player.** Seat token, host key and remembered name go to `sessionStorage` (per
  tab) instead of `localStorage` (per browser). The flag sticks for the tab's lifetime, so navigation and
  reloads keep it. It's opt-in per URL rather than a build flag because it only affects the visitor's own
  browser: anyone could already join extra seats from another device, so it grants nothing new. The discreet
  preference stays per browser.
- **Cards render at identical sizes.** The hand is a CSS grid of equal columns (`minmax(0, 1fr)`) and equal
  rows (`grid-auto-rows: 1fr`). Long words hyphenate inside a card instead of widening it, so a card's size
  can't hint at which card it is. The veto button isn't a card and gets its own full-width row. Discreet lists
  use the same equal-row grid. Checked in Chromium at 320/390/430 px, including with deliberately mismatched
  labels.
- **Games can be created from the TV, and the TV is their host** (Kevin's call, 2026-11-22; replaces an
  earlier "first phone to join hosts" version that was never deployed). "Start a new trip on this TV" (home
  page), plus "Start a new trip" on the TV's game-over and room-expired screens.
  - The TV keeps the room's host key (localStorage, per device) and presents it when it connects. Only that TV
    gets host powers, and only for rooms it created; a TV opened by typing the code can't.
  - The TV has every host control in a 👑 Host drawer (seat order, kick, settings, house rules, start, pause,
    play again), plus a big Start button in the TV lobby.
  - It can make any phone the host (e.g. if the TV is out of reach) and take hosting back at any time, even
    while a phone hosts. A phone host can also hand it back.
  - Rejoin codes on the TV are revealed **one player at a time for 20 seconds**, never as a list, because the
    TV is a shared screen. A host phone still sees the full list on its own screen.
  - If the TV's browser loses its stored key, nobody can take hosting from a phone host, but the room keeps
    working; if the TV itself was host at that point, the game can't be started or paused until a new room is
    made. Acceptable for a party game; noted here in case it bites.
