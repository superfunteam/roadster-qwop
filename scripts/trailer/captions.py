"""Create readable trailer dialogue captions from the mastered cue timings."""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--report', type=Path, default=ROOT / 'reference/qa/trailer/audio/final-mix-report.json')
parser.add_argument('--output-dir', type=Path, default=ROOT / 'output/roadster-trailer')
parser.add_argument('--output-prefix', help='Filename without .ass/.srt; defaults to the report duration.')
args = parser.parse_args()
report = json.loads(args.report.read_text())
out = args.output_dir
out.mkdir(parents=True, exist_ok=True)
prefix = args.output_prefix or f'roadster-hype-trailer-{float(report.get("duration", 60)):g}s'

def ass_time(seconds):
    centis = round(seconds * 100)
    return f'{centis // 360000}:{centis // 6000 % 60:02d}:{centis // 100 % 60:02d}.{centis % 100:02d}'

def srt_time(seconds):
    millis = round(seconds * 1000)
    return f'{millis // 3600000:02d}:{millis // 60000 % 60:02d}:{millis // 1000 % 60:02d},{millis % 1000:03d}'

ass = '''[Script Info]
Title: Roadster — But Can It Fly? | Trailer dialogue
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Dialogue,Arial,46,&H00FFFFFF,&H00FFFFFF,&H00101010,&H60000000,-1,0,0,0,100,100,0.5,0,1,3,1,2,96,96,90,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
'''
srt = []
for event in sorted(report['events'], key=lambda cue: cue['start']):
    if event.get('kind') != 'voice':
        continue
    start, end = event['start'], event['end']
    text = event.get('caption')
    if not text:
        continue
    position = r'{\an8\pos(960,180)}' if event.get('caption_position', 'top' if event['id'] == 'pilot-controls' else 'bottom') == 'top' else ''
    margin_v = max(0, int(event.get('caption_margin_v', 0)))
    # The final CTA deliberately has no burnt dialogue over its small print;
    # retain its spoken line in the optional accessibility subtitle file.
    if event.get('caption_burn', True):
        ass += f'Dialogue: 0,{ass_time(start)},{ass_time(end)},Dialogue,,0,0,{margin_v},,{position}{text}\n'
    srt.append(f'{len(srt)+1}\n{srt_time(start)} --> {srt_time(end)}\n{text}\n')
(out / f'{prefix}.ass').write_text(ass)
(out / f'{prefix}.srt').write_text('\n'.join(srt))
print('Caption files ready.')
