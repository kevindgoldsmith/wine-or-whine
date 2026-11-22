# Decisions

Judgement calls made while building, newest at the bottom of each section.

## Infrastructure
- **Single process, single replica, one uvicorn worker.** Live room state is held in memory and is
  authoritative; the Postgres snapshot written after every accepted action exists for restart recovery only.
  Scaling out would need a shared pub/sub and is out of scope.
- **No `railway.json` / `railway.toml`.** Service settings live in the Railway dashboard and are listed in the README.
- **Deploy path: GitHub-connected service, deploy branch `main`.** Work happens on branches and is merged to
  `main` only when Kevin okays a deploy, so deploys can be triggered from a phone. `railway up` with the project
  token stays available as a fallback.

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
