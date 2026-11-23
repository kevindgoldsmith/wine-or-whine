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

## Visual audit (2026-11-22)
`scripts/visual_audit.mjs` plays real games in Chromium with phones (320–768 px, plus landscape) and TVs
(960×540 to 1920×1080) all live at once, and on every new screen state checks for overlapping text,
colliding seats/cards, clipped or off-screen text, sideways scroll and small tap targets. Final runs
(10 players with long names, 7 and 5 players): 801 states, 0 issues. Fixes it drove:
- **TV scaling bug:** the scale factor was set on `<body>`, but `rem` follows `<html>`, so every TV rendered at a
  fixed 16 px base. Now `html.tv-mode` scales with min(width, height): each 16:9 screen shows the same layout
  (1280×720 → 16 px, 1920×1080 → 24 px).
- **TV fits one screen:** track cards sized in vh, captions reserved at 3 lines; at game over the captions are
  hidden (the coloured cards say it all) so the superlatives fit; "Start a new trip" moved into the header.
- **Seats:** placed at equal *arc length* around a rounded table using its measured on-screen shape (equal
  angles bunched them at the top and bottom); seats size to their content so names never break mid-word.
- **Pause bug:** the TV's pause screen covered the 👑 Host button, so a TV host couldn't resume. Fixed.
- **Superlatives:** a 4+-way tie is no award and is dropped.
- **Phone header:** two fixed rows that never wrap (was up to four on 320 px); not pinned on short landscape
  screens; the page scrolls to the top when it becomes your turn so the prompt's first line is visible.
- **Beats:** big icons get their own space (the sunrise ☀️ used to rise through the title); table notes
  (🤫, veto unlocked) stack instead of overlapping.

## "Itinerary" redesign (2026-11-23)
The first look read as generic. Of three proposed directions (mockups in a private canvas), Kevin picked
**Itinerary**: a group trip's paperwork on a kraft-paper table, with added wine-country scenery.
- **Look:** kraft background, paper sheets, ink navy, rubber-stamp red, vine green, masking-tape yellow. Type:
  DM Serif Display (headings), IBM Plex Mono (labels, logs), IBM Plex Sans (body), Caveat (handwriting).
  Self-hosted via @fontsource, so no font CDN.
- **Props, not panels:** players are luggage tags on a vine; cards are ticket stubs; votes are rubber stamps; the
  government is a boarding pass; the TV has an itinerary sheet (the log, one line per day), a "Greetings from
  Napa Valley" postcard and the ticket rail.
- **Scenery:** drawn as flat SVG in a vintage travel-print style (`web/src/scenery.tsx`) instead of AI or stock
  images. It's crisp on a 4K TV, tiny, has no licence questions, and can be toned down behind text.
- **Icons:** emoji in the interface were replaced by drawn line icons (`web/src/icons.tsx`) for a consistent look.
  Theme strings for logs/beats lost their emoji too; the theme's `icons` map still names a concept per key.
- **Discreet mode stays plain:** no icons, scenery, colours or art; same-size grey buttons in shuffled order,
  and the confirm button says "Pick one first" (not a choice-specific word) until something is picked.
- **Game over on the phone** says "You won!" / "You lost" with your team's name, and puts your own tag first.
- **Adversarial review:** a separate reviewer agent critiqued screenshots from the audit over five rounds
  (rough → 7 → 8 → 8.5/10, final verdict "ship"); every issue it raised was fixed or deliberately declined.
- **Audit additions:** a *fit* check (on a 320×568 phone the confirm and any short option list fit above the
  bottom bar, no option is half-hidden unless a long list shows a "↓ N more" hint), a mid-word split check
  and a coverage check. Long name lists scroll under a sticky confirm with that hint.

## Planning committee wording and the card moment (2026-11-23)
- Wording (Kevin): the pair up for a vote is the **planning committee**; the vote approves it. "Read someone's
  phone" is now "Read someone else's texts" everywhere (power name, log, voice, banner). Tagline: "Four couples,
  four babies, one trip to Napa."
- **Card moment** (Kevin: a witty line after each Breezy or Overscheduled Day, not after each vote). When a card is
  played, the TV's card beat and an overlay on every phone show the same slip: day and count in a coloured
  header, a BREEZY / OVERBOOKED stamp slamming on, a handwritten one-liner, and what's at stake. Lines live in
  the theme (`card_lines.B` / `card_lines.O`), picked by the card's count so the TV and phones agree and nothing
  repeats within a game. The TV beat no longer shows the fixed track caption (it's still on the ticket rail).
- The phone overlay lasts about 3.4 s and taps away, so it never holds up the next turn. Discreet mode shows it
  plain and still; reduced-motion turns the animation off. A first version fired on every passed vote; dropped.
- Walkthrough fixes: the phone game-over history folds away behind "Every step (n)" like the Recap; the host
  menu is titled "Host tools" with no emoji; TV awards shared by 3+ people use a smaller name size and the
  game-over board keeps extra room above the credit line. The "↓ N more" hint now re-measures after a pick
  (the confirm grows to two lines).

## Test mode as a host toggle (2026-11-23)
- Kevin asked for test mode to be a host setting. The lobby's host panel (phone host, and the TV's Host drawer)
  has a **Test mode** switch. While it's on, every browser tab that opens the room joins as its own player,
  exactly like `?test` (which still works per tab).
- A phone page checks `GET /api/rooms/{code}` (now includes `test_mode`) before connecting, so a new tab is
  marked before it could pick up another tab's seat. A tab that was already seated when the host switched it
  on copies its seat token into the tab when it hears about it, so it keeps its seat across reloads.
- Once a tab is a test tab it stays one for its lifetime, even if the host switches test mode off; new tabs
  behave normally again. The trade-off for real phones in a test-mode room: closing the tab (not just
  reloading) loses the seat, and the player needs their rejoin code. Hence "Leave off for real games."
- **iPhone QR scans in test mode** (Kevin: rescanning the TV's QR code on an iPhone didn't make a new player). iOS
  Safari reopens the tab already showing a URL instead of opening a new one, so every scan landed on the first
  player. In test mode the TV's QR code now carries a scan id that changes every 4 seconds; each scan is a
  distinct link, so Safari opens a new tab. A tab that arrives with a scan id it hasn't seen also starts as a
  new player, which covers browsers that reuse the tab anyway. The id is removed from the address bar, so a
  reload keeps the seat. The TV shows "Test mode · each scan is a new player" under the code.

## Discreet default and TV ticket notes (2026-11-23)
- Discreet mode was remembered per browser, so after one player in a browser turned it on, every later player
  there (and every test tab) started discreet. It's now remembered per player per room (per tab in test mode),
  so everyone starts in normal mode.
- Kevin: no notes on the played cards in the TV's ticket rail. Played tickets show only the stamp, centred;
  the card's one-liner is shown in the card moment instead. Empty tickets still show their power.

## Vote marks on role tags; "Trip journal" (2026-11-23)
- The First One Up's tag (and the nominee's) showed only the role during a vote, so nobody could tell whether
  they'd voted. During a vote those tags now add a second line, "Voted" with a tick or "Thinking…", on the TV
  and on phones.
- The TV's log sheet is titled "Trip journal" instead of "Itinerary" (Kevin).
- The layout audit now waits a moment before checking a screen, so the "↓ N more" hint has appeared.

## Faded card pictures; "the house" (2026-11-23)
- Each ticket in the TV's Breezy and Overscheduled rails has a faded line drawing behind it, drawn as SVG to
  match the rest: a hammock between two trees with sun and a glass (Breezy), a crammed calendar, a ringing
  alarm clock and a frantic zig-zag (Overscheduled). Played tickets show it a little stronger. It replaces the
  small placeholder icon on empty tickets. A first version put the drawings on the phone's hand cards and the
  card moment slip instead; Kevin meant the board, so that was undone.
- Babysitter duty now says players "stay back at the house" instead of "the rental" (Kevin).

## "First One Awake" (2026-11-23)
- The president role is now "First One Awake" (was "First One Up"), and the matching phrases say "wakes up
  first" ("Day 3. Sarah wakes up first."; breakfast duty: "they'll wake up first tomorrow").
- The peek power is "Check the forecast" (short label "Forecast"), with a sun-and-cloud icon; "Nap check" wasn't
  intuitive (Kevin picked it from four options).
