#!/usr/bin/env python3
"""Build a 60- or 80-second score from the game's original ElevenLabs music.

No API calls or credentials. Outputs a clean stereo WAV with deliberate space
for crashes and dialogue. Rerun from any working directory.
"""
import argparse
import json
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'reference/qa/trailer/audio'
OUT.mkdir(parents=True, exist_ok=True)
AUDIO = ROOT / 'public/audio'

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--duration', type=int, choices=(60, 80), default=60)
args = parser.parse_args()
duration = args.duration
# The extended picture adds ten seconds of Porsche action before the ramp and
# ten seconds of factory flying after the freeze. Both generated tracks have
# enough unused material to play continuously; no repeated or stretched loop.
extension = (duration - 60) / 2
freeze_start = 39 + extension
freeze_end = freeze_start + 2
resolve_start = duration - 4
drive_length = freeze_start - 6
ramp_length = resolve_start - freeze_end
master = OUT / f'roadster-trailer-music-{duration}s.wav'

# A quiet action hook, glossy reveal, full driving groove, comic silence,
# faster final montage, then a short, filtered logo resolve. Tiny fades avoid
# sample-boundary clicks while preserving hard editorial music cuts.
graph = f"""
[0:a]asplit=2[coldsrc][drivesrc];
[coldsrc]atrim=start=0:end=2.5,asetpts=PTS-STARTPTS,lowpass=f=650,highpass=f=70,volume=0.45,afade=t=out:st=2.46:d=0.04[cold];
[1:a]atrim=start=0:end=3.5,asetpts=PTS-STARTPTS,volume=0.82,afade=t=in:d=0.03,afade=t=out:st=3.45:d=0.05,adelay=2500|2500[hero];
[drivesrc]atrim=start=0:end={drive_length:g},asetpts=PTS-STARTPTS,volume=1.50,afade=t=in:d=0.012,afade=t=out:st={drive_length-.07:g}:d=0.07,adelay=6000|6000[drive];
[2:a]asplit=2[rampsrc][endsrc];
[rampsrc]atrim=start=0:end={ramp_length:g},asetpts=PTS-STARTPTS,volume=1.60,volume='if(lt(t,{ramp_length-2.4:g}),1,if(lt(t,{ramp_length-2:g}),1-(t-{ramp_length-2.4:g})*1.4,0.44))':eval=frame,afade=t=in:d=0.012,afade=t=out:st={ramp_length-.04:g}:d=0.04,adelay={freeze_end*1000:g}|{freeze_end*1000:g}[ramp];
[endsrc]atrim=start={ramp_length:g}:end={ramp_length+4:g},asetpts=PTS-STARTPTS,lowpass=f=1600,volume=0.48,afade=t=in:d=0.08,afade=t=out:st=2.0:d=2.0,adelay={resolve_start*1000:g}|{resolve_start*1000:g}[resolve];
[cold][hero][drive][ramp][resolve]amix=inputs=5:normalize=0:duration=longest,apad=whole_dur={duration},atrim=duration={duration},alimiter=limit=0.794:level=false,aresample=48000[out]
""".replace('\n','')
cmd = ['ffmpeg','-hide_banner','-loglevel','error','-y']
for name in ['music-drive','music-menu','music-ramp']:
    cmd += ['-i',str(AUDIO / f'{name}.mp3')]
cmd += ['-filter_complex',graph,'-map','[out]','-c:a','pcm_s24le','-ar','48000',str(master)]
subprocess.run(cmd, check=True)
subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(master),'-c:a','aac','-b:a','256k',str(master.with_suffix('.m4a'))],check=True)

plan = {
 'duration':duration,
 'format':'48 kHz / stereo / 24-bit PCM',
 'sources':['public/audio/music-drive.mp3','public/audio/music-menu.mp3','public/audio/music-ramp.mp3'],
 'sections':[
   {'start':0,'end':2.5,'purpose':'Cold-open action hook; filtered, quiet music under crash/voice'},
   {'start':2.5,'end':6,'purpose':'Glossy reveal with expensive, slightly silly lounge groove'},
   {'start':6,'end':freeze_start,'purpose':'Full electro-funk driving groove, 138 BPM'},
   {'start':freeze_start,'end':freeze_end,'purpose':'Intentional silence for one dry comic line'},
   {'start':freeze_end,'end':resolve_start-2,'purpose':'Faster electro breakbeat factory flight and montage, 148 BPM'},
   {'start':resolve_start-2,'end':resolve_start,'purpose':'Duck for biggest explosion'},
   {'start':resolve_start,'end':duration,'purpose':'Filtered logo resolve, fade to silence'}
 ],
 'notes':[
   'This is a music-only stem. No dialogue or game sound effects are baked in.',
   f'Add a percussive explosion/button at {resolve_start:g}s if it fits the picture.',
   'Dialogue should sit clearly above the score; duck score an additional 4-6dB during spoken lines.',
   'Master the finished trailer near -14 LUFS integrated, -1dBTP maximum.'
 ]
}
(OUT/('music-plan.json' if duration == 60 else f'music-plan-{duration}s.json')).write_text(json.dumps(plan,indent=2)+'\n')
print(master)
