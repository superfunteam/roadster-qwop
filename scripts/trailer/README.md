# Roadster gameplay trailers

The current master is `output/roadster-trailer/roadster-hype-trailer-v3-80s.mp4`: 80 seconds, 1920×1080, 30 fps, H.264 video and stereo AAC, with dialogue captions. Matching `.ass` and `.srt` files use the same filename prefix. The approved 60-second original and first 80-second extension remain separate files.

Gameplay uses the actual Three.js renderer, normal keyboard inputs and shipped physics. Capture controls frame timing and camera placement; it never forces vehicle positions, velocities, damage or explosions. The live control HUD records the actual Q/W/O/P thrust meters, drive keys, rear boost, speed, hull, timer and factory ring count. The introductory and closing hover shots are separate **branded showroom animations**, rendered with the game's car model and exhaust effects; they are not simulated player flight.

Rendered video, intermediate captures and mix masters are ignored by Git. Eight new stressed ElevenLabs voice performances are tracked under `scripts/trailer/audio-v3/`, outside `public/`, so they do not increase the deployed game payload or offline cache. The soundtrack also uses the existing ElevenLabs music, effects and voices, plus the game's two-note ring chime.

## Current edit

`edit-v3.json` is the picture edit decision list; `audio-events-v3.json` contains synchronized dialogue and effects. The opening holds on takeoff longer. There is one continuous garage exit, with boxes struck on the way into a barrel-roll crash, followed by a thruster-driven Tesla flip into the Porsche. Inversion plays continuously without the old freeze frame. Gigafactory now asks “Did I do a good job?!” and the crash montage has distinct yells for its impacts. The redesigned closing card lasts nine seconds and its spoken “Excellent data! Terrible landing!” line has no burnt-in caption; that line remains in the optional SRT.

| Time | Sequence |
| --- | --- |
| 0–6.2 | Takeoff, out-of-control spin and cold-open crash |
| 6.2–11 | Hovering Roadster title reveal with active jets |
| 11–19 | Single continuous garage barrel-roll crash |
| 19–34 | Quarter mile, “Which one is down?!”, and Porsche collision |
| 34–46 | Inversion ramp and crash |
| 46–56 | Gigafactory rings and failed flight |
| 56–71 | Crash montage with different yells |
| 71–80 | Hovering Roadster, play URL and extended closing card |

Garage footage uses the camera cutaway fix; inversion footage uses the corrected road surface. The two Porsche camera angles replay the same deterministic input sequence and collision.

## Rebuild the current master

Requires Node, project dependencies, Chrome, FFmpeg/FFprobe, Python with NumPy, and the local game server. Chrome and FFmpeg paths currently target this macOS workspace. Run commands from the repository root. Start the server in a separate terminal:

```sh
npm run dev -- --port 5173
```

Keep existing `reference/qa/trailer/raw` files to retain approved footage exactly. Recreate the shared gameplay recordings only if they are missing, then record the revised shots and showroom animations:

```sh
# Shared gameplay used by both 80-second versions; only needed if absent:
node scripts/trailer/capture.mjs --recipes=scripts/trailer/shots-hud-80.json
# Revised garage, Porsche and factory shots, including live controls:
node scripts/trailer/capture.mjs --recipes=scripts/trailer/shots-v3.json
node scripts/trailer/hero-hover.mjs
node scripts/trailer/design.mjs
node scripts/trailer/design-v3.mjs
```

The tracked voice files are ready to mix; regeneration is optional. `v3-generate-voices.py` reads `ELEVENLABS_API_KEY` from the environment or accepts `--key-file`, and `--replace` explicitly regenerates voices. Its prompts are in `v3-voice-prompts.json`. No API call is needed for a normal rebuild.

```sh
python3 scripts/trailer/v3-audio-bed.py --edit scripts/trailer/edit-v3.json
python3 scripts/trailer/audio-mix.py scripts/trailer/audio-events-v3.json
python3 scripts/trailer/captions.py \
  --report reference/qa/trailer/audio/v3-mix-report.json \
  --output-prefix roadster-hype-trailer-v3-80s
python3 scripts/trailer/v3-audio-qa.py
python3 scripts/trailer/edit.py --plan scripts/trailer/edit-v3.json \
  --audio reference/qa/trailer/audio/roadster-trailer-v3-80s.wav \
  --captions output/roadster-trailer/roadster-hype-trailer-v3-80s.ass \
  --output output/roadster-trailer/roadster-hype-trailer-v3-80s.mp4
```

The explicit output name preserves both earlier masters. Capture JSONs retain per-frame player/rival telemetry, ring passes and impact times. The audio QA verifies source bounds, frame-matched explosions, distinct montage yells and non-overlapping dialogue. `scout-v2.mjs` verifies recipes in Chrome at lower resolution; `scout-v3.mjs` searches control schedules in the shipped physics before browser verification. `recipes-v3-candidates.json` retains the verified stunt recipes used to develop the final shots.

The edit renderer validates every segment and the exact final frame count: 2,400 for the current master. `--reuse` checks source timestamps, sizes, overlay assets, edit parameters, renderer version and frame count before reusing a segment. HMR messages are suppressed during recording. Gameplay is captured at High quality; adaptive resolution is disabled because offline encoding latency does not represent game frame time.

## Earlier versions

`shots.json`, `edit.json` and `audio-events.json` preserve the original 60-second edit. `shots-hud-80.json`, `edit-80.json` and `audio-events-80.json` preserve the first 80-second extension; `shots-80.json` contains its clean cinematic variants. Keep the original raw files for an exact archival rebuild. If missing, use `capture.mjs --recipes=scripts/trailer/shots.json` to recreate the original shots with the current game, and run `design.mjs` for the shared overlays.

```sh
# Original 60-second master:
python3 scripts/trailer/audio-bed.py
python3 scripts/trailer/audio-mix.py scripts/trailer/audio-events.json
python3 scripts/trailer/captions.py
python3 scripts/trailer/edit.py --plan scripts/trailer/edit.json \
  --audio reference/qa/trailer/audio/roadster-trailer-final-60s.wav \
  --captions output/roadster-trailer/roadster-hype-trailer-60s.ass \
  --output output/roadster-trailer/roadster-hype-trailer-60s.mp4

# First extension; requires the original audio master above for its opening:
python3 scripts/trailer/audio-bed.py --duration 80
python3 scripts/trailer/audio-mix.py scripts/trailer/audio-events-80.json
python3 scripts/trailer/captions.py \
  --report reference/qa/trailer/audio/extended-mix-report.json
python3 scripts/trailer/edit.py --plan scripts/trailer/edit-80.json \
  --audio reference/qa/trailer/audio/roadster-trailer-extended-80s.wav \
  --captions output/roadster-trailer/roadster-hype-trailer-80s.ass \
  --output output/roadster-trailer/roadster-hype-trailer-80s.mp4
```
