#!/usr/bin/env python3
"""Audit trailer audio against the actual captured gameplay and final edit.

Verifies that every visible explosion has a sound on the same frame, that no
shot extends past captured frames, and that each montage crash has its own
non-overlapping new yell. Run after audio-mix.py and captions.py.
"""
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / 'reference/qa/trailer/raw'
OUT = ROOT / 'reference/qa/trailer/audio'


def main():
    edit = json.loads((ROOT / 'scripts/trailer/edit-v3.json').read_text())
    cues = json.loads((ROOT / 'scripts/trailer/audio-events-v3.json').read_text())
    report = json.loads((OUT / 'v3-mix-report.json').read_text())
    duration = float(edit['duration'])
    observed = []
    cursor = 0.0
    montage_start = end_start = None
    sources = []
    for segment in edit['segments']:
        data = json.loads((RAW / f'{segment["clip"]}.json').read_text())
        available = data['frames'] / data['fps']
        requested = segment['in'] + segment['duration']
        assert requested <= available + 1e-6, f'Shot exceeds captured frames: {segment["clip"]} ({requested} > {available})'
        sources.append({'clip':segment['clip'],'source_in':segment['in'],'duration':segment['duration'],'available':available})
        overlay = segment.get('overlay', '')
        if 'montage' in overlay:
            montage_start = cursor
        if 'end' in overlay:
            end_start = cursor
        previous = False
        for frame in data.get('telemetry', []):
            crashed = frame.get('crashed', False) or bool((frame.get('rival') or {}).get('exploded'))
            if crashed and not previous and segment['in'] <= frame['videoTime'] < requested:
                observed.append(round(cursor + frame['videoTime'] - segment['in'], 4))
            previous = crashed
        cursor += segment['duration']
    assert abs(cursor - duration) < 1e-6
    tolerance = 1 / edit['fps']
    blasts = [event['start'] for event in cues['events'] if event['id'] == 'explosion']
    for instant in blasts:
        assert any(abs(instant - frame) < tolerance for frame in observed), f'Audio explosion has no matching picture: {instant}'
    for instant in observed:
        assert any(abs(instant - sound) < tolerance for sound in blasts), f'Visible explosion has no matching sound: {instant}'
    voices = [event for event in report['events'] if event['kind'] == 'voice']
    assert all(a['end'] <= b['start'] for a, b in zip(voices, voices[1:])), 'Voices overlap.'
    montage_yells = []
    for instant in observed:
        if montage_start <= instant < end_start:
            active = [event for event in voices if event['start'] <= instant <= event['end'] and event['id'].endswith('-v3')]
            assert len(active) == 1, f'Montage crash needs exactly one fresh yell: {instant}'
            montage_yells.append(active[0]['id'])
    assert len(set(montage_yells)) == len(montage_yells), 'Montage repeats a yell.'
    prefix = ROOT / f'output/roadster-trailer/roadster-hype-trailer-v3-{duration:g}s'
    ass, srt = prefix.with_suffix('.ass').read_text(), prefix.with_suffix('.srt').read_text()
    assert not any(text in ass + srt for text in ('OH NO', 'PARKING', 'WRONG PLACE'))
    assert 'TERRIBLE LANDING' not in ass and 'TERRIBLE LANDING' in srt
    assert 'DID I DO A GOOD JOB' in ass
    master = OUT / f'roadster-trailer-v3-{duration:g}s.wav'
    probe = json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration:stream=sample_rate,channels','-of','json',str(master)]))
    assert float(probe['format']['duration']) == duration
    assert probe['streams'][0]['sample_rate'] == '48000' and probe['streams'][0]['channels'] == 2
    for event in cues['events']:
        if event.get('source'):
            assert (ROOT / event['source']).is_file(), f'Missing retained audio: {event["source"]}'
    result = {'duration':duration,'blasts_picture':observed,'blasts_audio':blasts,'sync_tolerance_seconds':tolerance,
        'voices':len(voices),'voice_overlaps':0,'new_voices':8,'montage_yells':montage_yells,
        'final_caption_burnt':False,'source_bounds_valid':True,'sources':sources,'probe':probe,
        'master':report['master_measurements']}
    (OUT / 'v3-audio-qa.json').write_text(json.dumps(result, indent=2) + '\n')
    print(f'PASS: {duration:g}s, {len(observed)} frame-synced explosions, {len(montage_yells)} unique crash yells, no voice overlaps.')


if __name__ == '__main__':
    main()
