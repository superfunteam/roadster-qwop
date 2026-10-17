#!/usr/bin/env python3
"""Generate trailer-only ElevenLabs voices; keep secrets and audio out of deployment.

ELEVENLABS_API_KEY or --key-file is required. Retained raw files make the default
run resumable without repeated API charges. --replace explicitly regenerates.
"""
import argparse
import concurrent.futures
import datetime
import importlib.util
import json
import os
from pathlib import Path
import threading
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
MODULE = importlib.util.spec_from_file_location('roadster_audio', ROOT / 'scripts/generate-audio.py')
AUDIO = importlib.util.module_from_spec(MODULE)
MODULE.loader.exec_module(AUDIO)
OUT = ROOT / 'scripts/trailer/audio-v3'
QA = ROOT / 'reference/qa/trailer/audio/generated'
RAW = QA / 'raw'
LOCK = threading.Lock()
STOP = threading.Event()


def read_key(path):
    if not path:
        return os.environ.get('ELEVENLABS_API_KEY', '')
    text = path.read_text().strip()
    if text.startswith('sk_'):
        return text
    for line in text.splitlines():
        name, sep, value = line.removeprefix('export ').partition('=')
        if sep and name.strip() == 'ELEVENLABS_API_KEY':
            return value.strip().strip('\"\'')
    return ''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--key-file', type=Path)
    parser.add_argument('--only', help='Comma-separated IDs')
    parser.add_argument('--replace', action='store_true')
    parser.add_argument('--master-only', action='store_true')
    options = parser.parse_args()
    key = read_key(options.key_file)
    if not options.master_only and not key.startswith('sk_'):
        raise SystemExit('An ElevenLabs secret key is required via the environment or --key-file.')
    spec = json.loads((ROOT / 'scripts/trailer/v3-voice-prompts.json').read_text())
    selected = set(options.only.split(',')) if options.only else None
    jobs = [job for job in spec['voices'] if not selected or job['id'] in selected]
    RAW.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    report_path = QA / 'v3-generation-report.json'
    report = json.loads(report_path.read_text()) if report_path.exists() else {'provider':'ElevenLabs','assets':{}}

    def generate(item):
        if STOP.is_set():
            return
        ident = item['id']
        raw = RAW / f'{ident}.mp3'
        output = OUT / f'{ident}.mp3'
        if output.exists() and not options.replace and not options.master_only:
            print(f'KEEP {ident}', flush=True)
            return
        endpoint, payload = AUDIO.request_for('voices', item)
        credits = None
        if not options.master_only and (not raw.exists() or options.replace):
            print(f'GENERATE {ident}', flush=True)
            req = urllib.request.Request('https://api.elevenlabs.io' + endpoint + '?output_format=mp3_44100_128',
                data=json.dumps(payload).encode(), headers={'xi-api-key':key,'Content-Type':'application/json'}, method='POST')
            try:
                with urllib.request.urlopen(req, timeout=180) as response:
                    data = response.read()
                    content_type = response.headers.get('Content-Type','')
                    credits = response.headers.get('character-cost')
                if len(data) < 1000 or not ('audio' in content_type or 'octet-stream' in content_type):
                    raise RuntimeError(f'Unexpected response for {ident}: {content_type}, {len(data)} bytes')
                raw.write_bytes(data)
            except urllib.error.HTTPError as error:
                STOP.set()
                detail = error.read().decode(errors='replace').replace(key, '[redacted]')
                raise RuntimeError(f'{ident}: ElevenLabs HTTP {error.code}: {detail[:600]}') from None
        if not raw.exists():
            raise RuntimeError(f'No retained raw audio for {ident}')
        metadata = AUDIO.master(raw, output, 'voices', False)
        metadata.update({'id':ident,'role':item['role'],'voiceId':AUDIO.VOICES[item['role']],
            'model':payload['model_id'],'text':item['text'],'caption':item['caption'],
            'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()})
        if credits:
            metadata['generationCredits'] = credits
        with LOCK:
            report['assets'][ident] = metadata
            report_path.write_text(json.dumps(report, indent=2) + '\n')
        print(f'READY {ident} {metadata["duration"]:.2f}s', flush=True)

    errors = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        for future in concurrent.futures.as_completed([pool.submit(generate,item) for item in jobs]):
            try:
                future.result()
            except Exception as error:
                message = str(error).replace(key,'[redacted]') if key else str(error)
                errors.append(message)
                print('ERROR ' + message, flush=True)
    if errors:
        raise SystemExit(1)
    print(f'Ready: {len(jobs)} requested trailer-only voices.')


if __name__ == '__main__':
    main()
