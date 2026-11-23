# How-to-play explainer video

A narrated, ~3-minute explainer in the game's look, rendered from `explainer.html` (a timed animation).

1. Narration (local, no API key): `pip install kokoro-onnx soundfile`, put `kokoro-v1.0.onnx` and `voices-v1.0.bin`
   from the kokoro-onnx GitHub release in `models/` (or set `KOKORO_DIR`), then `python3 voice.py`.
   It writes `narration.wav` and `timemap.json` (each caption window stretched to fit its line).
2. Put the time map into the page (the `TMAP` constant) if the captions changed.
3. Mix the music bed under the narration with ffmpeg (sidechain ducking), e.g. into `mix.wav`.
4. `node render.mjs $PWD/explainer.html $PWD/mix.wav $PWD/out.mp4 <seconds> 30` (Playwright + ffmpeg).
   `node frames.mjs $PWD/explainer.html ./frames 12 45 90` renders stills for checking.

Captions and chapters live in the `CH` and `CAP` arrays at the top of the script; keep them in the theme's wording.
Generated files (wav, mp4, models) are not committed.

After changing captions: `python3 voice.py` → `python3 update_timemap.py` → mix → render.
