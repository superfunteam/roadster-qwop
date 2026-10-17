"""Render an editorial from genuine captured game frames."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / 'reference/qa/trailer/raw'
DESIGN = ROOT / 'reference/qa/trailer/design'
OUT = ROOT / 'output/roadster-trailer'
FFMPEG = '/opt/homebrew/bin/ffmpeg'
parser = argparse.ArgumentParser()
parser.add_argument('--plan', default=str(ROOT / 'scripts/trailer/edit.json'))
parser.add_argument('--audio', help='Final mastered soundtrack')
parser.add_argument('--captions', help='ASS dialogue captions')
parser.add_argument('--reuse', action='store_true', help='Reuse only segments with matching sources, edit and renderer')
args = parser.parse_args()
plan_path = Path(args.plan).resolve()
plan = json.loads(plan_path.read_text())
duration = plan['duration']
fps = plan['fps']
assert abs(sum(s['duration'] for s in plan['segments']) - duration) < .0001
WORK = ROOT / 'reference/qa/trailer' / plan_path.stem
WORK.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)
renderer_hash = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()

def command(options):
    subprocess.run([FFMPEG, '-hide_banner', '-loglevel', 'error', '-y', *options], check=True)

def frame_count(file):
    info = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=nb_frames', '-of', 'json', str(file)]))
    return int(info['streams'][0]['nb_frames'])

def fingerprint(segment):
    sources = [RAW / (segment['clip'] + '.mp4')]
    if segment.get('overlay'):
        sources.append(DESIGN / (segment['overlay'] + '.png'))
    data = {'renderer': renderer_hash, 'fps': fps, 'segment': segment,
            'sources': [(str(p), p.stat().st_size, p.stat().st_mtime_ns) for p in sources]}
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()

def render_segment(pair):
    index, segment = pair
    length = segment['duration']
    output = WORK / f'{index:02d}.mp4'
    stamp = WORK / f'{index:02d}.sha256'
    expected = fingerprint(segment)
    if args.reuse and output.exists() and stamp.exists() and stamp.read_text() == expected:
        if frame_count(output) == round(length * fps):
            print(f'Reused {index:02d} {segment["clip"]}', flush=True)
            return output
    source = RAW / (segment['clip'] + '.mp4')
    options = ['-ss', str(segment['in']), '-i', str(source)]
    if segment.get('freeze'):
        still = WORK / f'{index:02d}-freeze.png'
        command(['-ss', str(segment['in']), '-i', str(source), '-frames:v', '1', str(still)])
        options = ['-loop', '1', '-framerate', str(fps), '-i', str(still)]
    if segment.get('overlay'):
        options += ['-loop', '1', '-i', str(DESIGN / (segment['overlay'] + '.png'))]
    # Only a small tonal adjustment; all vehicle motion and particles are real.
    base = 'setpts=PTS-STARTPTS,eq=contrast=1.04:saturation=0.98:brightness=-0.012'
    if segment.get('freeze'):
        base = 'setpts=PTS-STARTPTS,eq=saturation=0.55:contrast=1.04'
    graph = f'[0:v]{base},fps={fps},setsar=1[scene];'
    if segment.get('overlay'):
        graph += '[1:v]format=rgba,fade=t=in:st=0:d=0.16:alpha=1'
        if segment['overlay'] != 'end':
            graph += f',fade=t=out:st={max(.2, length - .2)}:d=0.2:alpha=1'
        graph += '[title];[scene][title]overlay=0:0:shortest=1[v]'
    else:
        graph += '[scene]null[v]'
    options += ['-filter_complex_threads', '1', '-filter_complex', graph, '-map', '[v]', '-an', '-t', str(length),
                '-r', str(fps), '-c:v', 'libx264', '-preset', 'fast', '-crf', '17', '-threads', '2', '-pix_fmt', 'yuv420p', str(output)]
    command(options)
    assert frame_count(output) == round(length * fps), f'Incomplete segment: {source.name}'
    stamp.write_text(expected)
    print(f'Rendered {index:02d} {segment["clip"]} / {length}s', flush=True)
    return output

with ThreadPoolExecutor(max_workers=3) as pool:
    files = list(pool.map(render_segment, enumerate(plan['segments'])))
concat = WORK / 'concat.txt'
concat.write_text(''.join(f"file '{file}'\n" for file in files))
picture = WORK / 'picture.mp4'
command(['-f', 'concat', '-safe', '0', '-i', str(concat), '-c', 'copy', '-movflags', '+faststart', str(picture)])
assert frame_count(picture) == round(duration * fps), f'Trailer must be exactly {duration} seconds.'
if args.audio:
    output = OUT / f'roadster-hype-trailer-{duration}s.mp4'
    opts = ['-i', str(picture), '-i', str(Path(args.audio).resolve()), '-map', '0:v:0', '-map', '1:a:0']
    if args.captions:
        opts += ['-vf', f"ass={Path(args.captions).resolve()}", '-c:v', 'libx264', '-crf', '18', '-preset', 'slow', '-threads', '6']
    else:
        opts += ['-c:v', 'copy']
    opts += ['-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-ac', '2', '-t', str(duration), '-pix_fmt', 'yuv420p',
             '-movflags', '+faststart', '-metadata', 'title=Roadster — But Can It Fly? | Official Gameplay Trailer',
             '-metadata', f'comment=Captured from actual game physics and player inputs. {duration}-second gameplay edit.', str(output)]
    command(opts)
    print(output)
else:
    print(picture)
