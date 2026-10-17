#!/usr/bin/env python3
"""Score the revised gameplay edit without the old freeze-frame music stop.

Reads section boundaries from its EDL, keeps the existing ElevenLabs score,
and lets the extended CTA breathe before the final two-second fade.
"""
import argparse
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'reference/qa/trailer/audio'
AUDIO = ROOT / 'public/audio'


def run(args):
    subprocess.run(args, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--edit', type=Path, default=ROOT / 'scripts/trailer/edit-v3.json')
    args = parser.parse_args()
    spec = json.loads(args.edit.read_text())
    duration = float(spec['duration'])
    cursor = 0.0
    sections = {}
    for segment in spec['segments']:
        overlay = segment.get('overlay', '')
        for key in ('intro', 'garage', 'factory', 'end'):
            if key in overlay and key not in sections:
                sections[key] = cursor
        cursor += float(segment['duration'])
    if abs(cursor - duration) > .001:
        raise ValueError('EDL duration does not match its segments.')
    missing = {'intro', 'garage', 'factory', 'end'} - sections.keys()
    if missing:
        raise ValueError(f'EDL is missing score section overlays: {sorted(missing)}')
    cold_end, hero_end = sections['intro'], sections['garage']
    drive_end, resolve_start = sections['factory'], sections['end']
    if not 0 < cold_end < hero_end < drive_end < resolve_start < duration:
        raise ValueError(f'Unexpected score section order: {sections}')
    hero_length = hero_end - cold_end
    drive_length = drive_end - hero_end
    ramp_length = resolve_start - drive_end
    end_length = duration - resolve_start
    # Existing tracks are 48 / 32 / 42 seconds. Preserve actual musical timing;
    # never silently pad a source that proves shorter than a revised section.
    if max(cold_end, drive_length) > 47.5 or hero_length > 31.5 or ramp_length + end_length > 41.5:
        raise ValueError('The EDL needs a longer music arrangement; source would run out.')
    OUT.mkdir(parents=True, exist_ok=True)
    master = OUT / f'roadster-trailer-v3-music-{duration:g}s.wav'
    graph = f'''
[0:a]asplit=2[coldsrc][drivesrc];
[coldsrc]atrim=start=0:end={cold_end:g},asetpts=PTS-STARTPTS,lowpass=f=850,highpass=f=65,volume=0.56,afade=t=out:st={cold_end-.05:g}:d=0.05[cold];
[1:a]atrim=start=0:end={hero_length:g},asetpts=PTS-STARTPTS,volume=0.82,afade=t=in:d=0.03,afade=t=out:st={hero_length-.06:g}:d=0.06,adelay={hero_end*1000-hero_length*1000:g}|{hero_end*1000-hero_length*1000:g}[hero];
[drivesrc]atrim=start=0:end={drive_length:g},asetpts=PTS-STARTPTS,volume=1.50,afade=t=in:d=0.012,afade=t=out:st={drive_length-.06:g}:d=0.06,adelay={hero_end*1000:g}|{hero_end*1000:g}[drive];
[2:a]asplit=2[rampsrc][endsrc];
[rampsrc]atrim=start=0:end={ramp_length:g},asetpts=PTS-STARTPTS,volume=1.60,afade=t=in:d=0.02,afade=t=out:st={ramp_length-.045:g}:d=0.045,adelay={drive_end*1000:g}|{drive_end*1000:g}[ramp];
[endsrc]atrim=start={ramp_length:g}:end={ramp_length+end_length:g},asetpts=PTS-STARTPTS,lowpass=f=2800,volume=0.76,afade=t=in:d=0.06,afade=t=out:st={max(0,end_length-2.2):g}:d={min(end_length,2.2):g},adelay={resolve_start*1000:g}|{resolve_start*1000:g}[resolve];
[cold][hero][drive][ramp][resolve]amix=inputs=5:normalize=0:duration=longest,apad=whole_dur={duration:g},atrim=duration={duration:g},alimiter=limit=0.794:level=false,aresample=48000[out]
'''.replace('\n', '')
    cmd = ['ffmpeg','-hide_banner','-loglevel','error','-y']
    for name in ('music-drive', 'music-menu', 'music-ramp'):
        cmd += ['-i', str(AUDIO / f'{name}.mp3')]
    cmd += ['-filter_complex', graph, '-map', '[out]', '-c:a', 'pcm_s24le', '-ar', '48000', str(master)]
    run(cmd)
    (OUT / 'v3-music-plan.json').write_text(json.dumps({
        'duration':duration,'source_edl':str(args.edit.relative_to(ROOT) if args.edit.is_absolute() else args.edit),
        'sources':['public/audio/music-drive.mp3','public/audio/music-menu.mp3','public/audio/music-ramp.mp3'],
        'sections':[
            {'start':0,'end':cold_end,'purpose':'Takeoff and cold-open crash, filtered driving hook'},
            {'start':cold_end,'end':hero_end,'purpose':'Hover reveal, existing luxury lounge groove'},
            {'start':hero_end,'end':drive_end,'purpose':'Continuous electro-funk garage/race/inversion gameplay'},
            {'start':drive_end,'end':resolve_start,'purpose':'Faster breakbeat through rings and crash montage'},
            {'start':resolve_start,'end':duration,'purpose':'Nine-second branded resolve, late final fade'}
        ],'notes':['No freeze-frame stop. Dialogue and explosions duck the score in the final mix.']
    }, indent=2) + '\n')
    print(master)


if __name__ == '__main__':
    main()
