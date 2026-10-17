# Roadster gameplay trailers

The extended master is `output/roadster-trailer/roadster-hype-trailer-80s.mp4`: 80 seconds, 1920×1080, 30 fps, H.264, stereo AAC, with burnt-in dialogue captions. Matching SRT/ASS files and a poster accompany it. The approved original `roadster-hype-trailer-60s.mp4` is preserved separately. Rendered media and intermediate captures are ignored by Git; they do not inflate the game download or offline cache.

All gameplay uses the actual Three.js renderer, normal keyboard inputs, and shipped physics. Capture controls frame timing and camera placement; it never forces vehicle position, velocity, damage, or explosions. Porsche impacts, flying parts, and factory ring passes are genuine game events. Audio uses the project's existing ElevenLabs music, effects and stressed voices, plus the game's two-note ring chime.

## Extended edit

The original opening footage and first six seconds of mastered audio are retained. Every gameplay shot after the opening includes the actual game control panel: Q/W/O/P thrust meters, arrow-key presses, rear boost, speed, hull, timer and factory ring count. These are captured live from the DOM, not animated in post. The HUD is raised slightly to leave room for captions. Fresh garage recordings use the camera cutaway fix, and fresh inversion recordings use the corrected road surface. The added sequences show two Porsche collisions, a clean five-ring factory run, and a failed flight with a crash and explosion.

| Time | Sequence |
| --- | --- |
| 0–6 | Original cold open and logo reveal |
| 6–16 | Garage destruction with unobstructed camera |
| 16–27 | Quarter mile and booster chaos |
| 27–37 | Porsche pileup and explosive rear-end collision |
| 37–49 | Inversion ramp |
| 49–51 | Intentional freeze-frame punchline |
| 51–61 | Gigafactory ring run and failed flight |
| 61–76 | Rapid crash montage |
| 76–80 | Original logo and play URL |

## Rebuild

Requires Node, project dependencies, Chrome, FFmpeg/FFprobe, Python with NumPy, and the local game server. Chrome and FFmpeg paths currently target this macOS workspace. Keep `reference/qa/trailer/raw` to preserve the exact original approved opening; regenerating those original captures uses the current version of the game.

Start the game server, then capture any missing original footage and all fresh extended footage:

```sh
npm run dev -- --port 5173
# Only if the original capture files are missing:
node scripts/trailer/capture.mjs --recipes=scripts/trailer/shots.json
# Fresh gameplay with the real control HUD, telemetry and ring counter:
node scripts/trailer/capture.mjs --recipes=scripts/trailer/shots-hud-80.json
node scripts/trailer/design.mjs
```

Build the original audio master first if absent; the extended mix retains its opening samples exactly:

```sh
python3 scripts/trailer/audio-bed.py
python3 scripts/trailer/audio-mix.py scripts/trailer/audio-events.json
python3 scripts/trailer/audio-bed.py --duration 80
python3 scripts/trailer/audio-mix.py scripts/trailer/audio-events-80.json
python3 scripts/trailer/captions.py --report reference/qa/trailer/audio/extended-mix-report.json
python3 scripts/trailer/edit.py --plan scripts/trailer/edit-80.json \
  --audio reference/qa/trailer/audio/roadster-trailer-extended-80s.wav \
  --captions output/roadster-trailer/roadster-hype-trailer-80s.ass
```

`shots-hud-80.json` contains the final gameplay recordings; `shots-80.json` also retains the clean cinematic variants. `edit-80.json` is the extended picture edit decision list, and `audio-events-80.json` holds the synchronized cues. `edit.json`, `shots.json` and `audio-events.json` preserve the original 60-second recipe. Capture JSONs retain per-frame player/rival physics telemetry, ring passes, and impact times. `scout-v2.mjs` tests recipes at low resolution before final capture.

The edit renderer validates every segment and the exact final frame count (2,400 for the extended edit). `--reuse` checks source timestamps, sizes, overlay assets, edit parameters, renderer version and frame count before reusing a segment. HMR messages are suppressed while recording so unrelated file edits cannot reload a shot.

Normal graphics are captured at High quality. Adaptive resolution is disabled during offline capture because encoding latency is not representative of game performance. The trailer does not establish stability on any particular phone.
