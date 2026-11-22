# Wine or Whine

(Full README arrives in milestone 4.)

## Railway setup Kevin needs to do (dashboard)
1. Create a project with two services: this repo (GitHub-connected, deploy branch `main`) and Postgres
   (New → Database → PostgreSQL).
2. App service variables: `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `PUBLIC_BASE_URL=https://<generated domain>`,
   `TTS_PROVIDER` (`none` | `elevenlabs` | `openai`), `TTS_API_KEY`, `TTS_VOICE_ID`. Railway provides `PORT`.
3. Settings: health-check path `/livez`; restart policy *On failure*; 1 replica; Serverless / App Sleeping **off**.
4. Networking: generate a public domain and copy it into `PUBLIC_BASE_URL`.
