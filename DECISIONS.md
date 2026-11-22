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
