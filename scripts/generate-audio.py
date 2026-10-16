#!/usr/bin/env python3
"""Generate the static ElevenLabs game pack; never embed a key in web assets.

Requires ELEVENLABS_API_KEY or --key-file pointing outside the repository,
Python 3, ffmpeg and ffprobe. Existing files are preserved unless --replace.
"""
import argparse
import concurrent.futures
import datetime
import json
import math
import os
from pathlib import Path
import re
import subprocess
import threading
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
VOICES = {"pilot": "SOYHLrjzK2X1ezoPC6cr", "mission": "Xb7hH8MSUJpSbSDYk0k2"}
stop = threading.Event()
lock = threading.Lock()


def command(args):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f"{Path(args[0]).name} failed: {result.stderr[-1200:]}")
    return result


def master(raw, output, category, loop):
    """Trim dead air from one-shots and use measured two-pass loudness gain."""
    target = -22 if category == "music" else -24 if loop else -17 if category == "voices" else -19
    # Downmix before measuring: changing channel layout after loudness matching
    # can add up to 3 dB and clip a dense stereo impact when exported as mono.
    trim = "aformat=channel_layouts=" + ("stereo" if category == "music" or loop else "mono") + ","
    if not loop:
        trim += "silenceremove=start_periods=1:start_duration=0.015:start_threshold=-52dB:start_silence=0.015,areverse,silenceremove=start_periods=1:start_duration=0.06:start_threshold=-50dB:start_silence=0.12,areverse,"
    loud = f"loudnorm=I={target}:TP=-2:LRA=11"
    measured = command(["ffmpeg", "-hide_banner", "-i", str(raw), "-af", trim + loud + ":print_format=json", "-f", "null", "-"])
    blocks = re.findall(r'\{\s*"input_i".*?\}', measured.stderr, re.S)
    stats = json.loads(blocks[-1]) if blocks else {}
    if stats and all(math.isfinite(float(stats[k])) for k in ["input_i", "input_tp", "input_lra", "input_thresh", "target_offset"]):
        loud += ":measured_I={input_i}:measured_TP={input_tp}:measured_LRA={input_lra}:measured_thresh={input_thresh}:offset={target_offset}:linear=true".format(**stats)
    else:
        # Very short isolated transients may not contain an EBU loudness window.
        peak = float(stats.get("input_tp", -3))
        loud = f"volume={min(12, -3 - peak):.2f}dB" if math.isfinite(peak) else "anull"
    pending = output.with_suffix(".pending.mp3")
    command(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(raw), "-af", trim + loud,
             "-ar", "44100", "-ac", "2" if category == "music" or loop else "1", "-codec:a", "libmp3lame",
             "-b:a", "128k" if category == "music" else "96k", "-map_metadata", "-1", str(pending)])
    pending.replace(output)
    probe = json.loads(command(["ffprobe", "-v", "error", "-show_entries", "format=duration,size", "-of", "json", str(output)]).stdout)
    return {"duration": float(probe["format"]["duration"]), "bytes": int(probe["format"]["size"]), "targetLufs": target}


def request_for(category, item):
    if category == "effects":
        return "/v1/sound-generation", {"text": item["prompt"], "duration_seconds": item["duration"],
            "loop": item.get("loop", False), "prompt_influence": 0.65, "model_id": "eleven_text_to_sound_v2"}
    if category == "voices":
        return "/v1/text-to-speech/" + VOICES[item["role"]], {"text": item["text"], "model_id": "eleven_v3",
            "voice_settings": {"stability": 0.0, "similarity_boost": 0.75}}
    return "/v1/music", {"prompt": item["prompt"], "music_length_ms": round(item["duration"] * 1000),
                           "model_id": "music_v2_5", "force_instrumental": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--key-file", type=Path)
    parser.add_argument("--only", help="Comma-separated IDs or groups: effects,voices,music")
    parser.add_argument("--replace", action="store_true")
    parser.add_argument("--master-only", action="store_true", help="Re-master retained raw audio without making API calls")
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--plan", action="store_true", help="Print IDs without requesting generation")
    options = parser.parse_args()
    spec = json.loads((ROOT / "scripts/audio-prompts.json").read_text())
    selected = set(options.only.split(",")) if options.only else None
    jobs = [(category, item) for category, items in spec.items() for item in items
            if not selected or category in selected or item["id"] in selected]
    if options.plan:
        print(json.dumps({"count": len(jobs), "ids": [item["id"] for _, item in jobs]}, indent=2))
        return
    key = options.key_file.read_text().strip() if options.key_file else os.environ.get("ELEVENLABS_API_KEY", "")
    if not options.master_only and not key.startswith("sk_"):
        raise SystemExit("A secret ElevenLabs API key starting sk_ is required; API key IDs cannot authenticate.")
    output_dir = ROOT / "public/audio"
    raw_dir = ROOT / "reference/qa/audio-raw"
    output_dir.mkdir(parents=True, exist_ok=True)
    raw_dir.mkdir(parents=True, exist_ok=True)
    report_path = ROOT / "reference/audio-generation.json"
    report = json.loads(report_path.read_text()) if report_path.exists() else {"provider": "ElevenLabs", "assets": {}}

    def generate(category, item):
        if stop.is_set():
            return
        name = item["id"]
        output = output_dir / (name + ".mp3")
        if output.exists() and not options.replace and not options.master_only:
            print(f"KEEP {name}", flush=True)
            return
        raw = raw_dir / (name + ".mp3")
        endpoint, payload = request_for(category, item)
        cost = None
        if options.master_only and not raw.exists():
            raise RuntimeError(f"No retained raw audio for {name}")
        if not options.master_only and (not raw.exists() or options.replace):
            print(f"GENERATE {name}", flush=True)
            req = urllib.request.Request("https://api.elevenlabs.io" + endpoint + "?output_format=mp3_44100_128",
                data=json.dumps(payload).encode(), headers={"xi-api-key": key, "Content-Type": "application/json"}, method="POST")
            try:
                with urllib.request.urlopen(req, timeout=300) as response:
                    content_type = response.headers.get("Content-Type", "")
                    data = response.read()
                    cost = response.headers.get("character-cost")
                    if not ("audio" in content_type or "octet-stream" in content_type) or len(data) < 1000:
                        raise RuntimeError(f"Unexpected response for {name}: {content_type}, {len(data)} bytes")
                    raw.write_bytes(data)
            except urllib.error.HTTPError as error:
                if error.code in [400, 401, 402, 403, 429]:
                    stop.set()
                # The response is diagnostic data; never print request headers.
                detail = error.read().decode(errors="replace").replace(key, "[redacted]")
                raise RuntimeError(f"{name}: ElevenLabs HTTP {error.code}: {detail[:700]}") from None
        metadata = master(raw, output, category, item.get("loop", False))
        metadata.update({"category": category, "model": payload["model_id"], "prompt": item.get("prompt", item.get("text")),
                         "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "loop": item.get("loop", False)})
        if category == "voices":
            metadata["voiceId"] = VOICES[item["role"]]
        if cost:
            metadata["generationCredits"] = cost
        with lock:
            report["assets"][name] = metadata
            report_path.write_text(json.dumps(report, indent=2) + "\n")
        print(f"READY {name} {metadata['duration']:.2f}s {metadata['bytes'] // 1024}KiB", flush=True)

    failed = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(3, options.workers))) as pool:
        futures = [pool.submit(generate, category, item) for category, item in jobs]
        for future in concurrent.futures.as_completed(futures):
            try:
                future.result()
            except Exception as error:
                failed.append(str(error).replace(key, "[redacted]") if key else str(error))
                print("ERROR " + failed[-1], flush=True)
    if failed:
        raise SystemExit(1)
    print(f"Pack ready: {len(list(output_dir.glob('*.mp3')))} files", flush=True)


if __name__ == "__main__":
    main()
