#!/usr/bin/env python3
"""Mix a picture-synced trailer cue sheet with the generated music bed.

Usage: python3 scripts/trailer/audio-mix.py /path/to/events.json
JSON format: {"events": [{"id": "pilot-oh-no", "start": 0.1,
"kind": "voice", "gain_db": 1.5, "duration": 1.8}], "name": "final"}
Optional event keys: source_start, playback_rate, pan (-1..1), gain_db.
Effects default to modest gain. Explosion/fire are compressed before mixing.
Voices automatically duck the music with a short attack and smooth release.
"""
import argparse
import json
import math
import pathlib
import re
import subprocess
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[2]
AUDIO = ROOT / 'public/audio'
OUT = ROOT / 'reference/qa/trailer/audio'
RATE = 48000


def decode(path, filters=None):
    cmd = ['ffmpeg','-v','error','-i',str(path)]
    if filters:
        cmd += ['-af', filters]
    cmd += ['-ar',str(RATE),'-ac','2','-f','f32le','-']
    return np.frombuffer(subprocess.check_output(cmd),dtype='<f4').reshape(-1,2).copy()


def ring_pass(count):
    """Mirror AudioSystem.ringPass's two sine oscillators and gain envelopes."""
    base = 523.25 * 2 ** ((min(5, max(1, int(count))) - 1) / 12)
    mono = np.zeros(round(.375 * RATE), dtype=np.float32)
    t = np.arange(round(.3 * RATE)) / RATE
    gain = .075 * np.minimum(t / .008, 1)
    # Exponential gain ramp reaches .001 exactly at .28s, then holds to .30s.
    gain[t >= .008] = .075 * (.001 / .075) ** ((np.minimum(t[t >= .008], .28) - .008) / .272)
    for index, frequency in enumerate((base, base * 1.5)):
        start = round(index * .075 * RATE)
        mono[start:start + len(t)] += np.sin(2 * np.pi * frequency * t) * gain
    return np.column_stack((mono, mono))


def envelope(mask, start, end, gain, attack=.06, release=.24):
    """Multiply an automation mask with a smooth duck at a spoken cue."""
    samples = len(mask)
    i0 = max(0,round((start-attack)*RATE))
    i1 = max(0,min(samples,round(start*RATE)))
    i2 = max(0,min(samples,round(end*RATE)))
    i3 = max(i2,min(samples,round((end+release)*RATE)))
    if i1>i0:
        mask[i0:i1] = np.minimum(mask[i0:i1],np.linspace(1,gain,i1-i0))
    if i2>i1:
        mask[i1:i2] = np.minimum(mask[i1:i2],gain)
    if i3>i2:
        mask[i2:i3] = np.minimum(mask[i2:i3],np.linspace(gain,1,i3-i2))


def render_float(path, samples):
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','f32le','-ar',str(RATE),'-ac','2','-i','-','-c:a','pcm_f32le',str(path)],input=samples.astype('<f4').tobytes(),check=True)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('cue_sheet',type=pathlib.Path)
    args=parser.parse_args()
    spec=json.loads(args.cue_sheet.read_text())
    length=float(spec.get('duration',60))
    if not 0 < length <= 3600:
        raise ValueError('Cue sheet duration must be between 0 and 3600 seconds.')
    samples=round(RATE*length)
    events=spec['events']
    name=spec.get('name','final')
    OUT.mkdir(parents=True,exist_ok=True)
    music_path=ROOT/spec['music'] if spec.get('music') else OUT/f'roadster-trailer-music-{length:g}s.wav'
    music=decode(music_path)[:samples]
    music=np.pad(music,((0,max(0,samples-len(music))),(0,0)))
    duck=np.ones(samples,dtype=np.float32)
    voice=np.zeros((samples,2),dtype=np.float32)
    effects=np.zeros_like(voice)
    effect_duck=np.ones(samples,dtype=np.float32)
    rendered=[]
    for event in events:
        ident=event['id']
        kind=event.get('kind','voice' if ident.startswith(('pilot-','mission-')) else 'effect')
        if ident == 'ring-pass':
            data = ring_pass(event.get('count', 1))
        else:
            path=AUDIO/f'{ident}.mp3'
            if not path.is_file():
                raise FileNotFoundError(path)
            filters=['highpass=f=40']
            source_start=float(event.get('source_start',0))
            filters+= [f'atrim=start={source_start}', 'asetpts=PTS-STARTPTS']
            speed=float(event.get('playback_rate',1))
            if speed!=1:
                filters.append(f'atempo={speed}')
            duration=event.get('duration')
            if duration is not None:
                filters.append(f'atrim=duration={duration}')
            if ident in ('explosion','fire-loop','impact-heavy-1'):
                filters.append('acompressor=threshold=0.13:ratio=3:attack=2:release=130:makeup=1.3')
            data=decode(path,','.join(filters))
        gain=float(event.get('gain_db',1.5 if kind=='voice' else -2.0))
        data*=10**(gain/20)
        # Avoid discontinuities on trimmed cues without softening transients.
        fade_in=min(len(data)//2,round(float(event.get('fade_in',0))*RATE))
        if fade_in:
            data[:fade_in]*=np.linspace(0,1,fade_in)[:,None]
        fade=min(len(data)//2,round(float(event.get('fade_out',.018))*RATE))
        if fade:
            data[-fade:]*=np.linspace(1,0,fade)[:,None]
        pan=float(event.get('pan',0))
        if pan:
            data[:,0]*=math.sqrt(1-max(0,pan))
            data[:,1]*=math.sqrt(1-max(0,-pan))
        start=float(event['start']);i=max(0,round(start*RATE))
        n=min(len(data),samples-i)
        if n<=0:
            continue
        (voice if kind=='voice' else effects)[i:i+n]+=data[:n]
        end=start+n/RATE
        if kind=='voice':
            envelope(duck,start,end,10**(-7/20))
            envelope(effect_duck,start,end,10**(-4/20),attack=.035,release=.16)
        elif ident=='explosion':
            envelope(duck,start,min(end,start+1.4),10**(-3/20),attack=.025,release=.35)
        rendered.append({**event,'kind':kind,'end':round(end,4),'rendered_duration':round(n/RATE,4)})
    music*=duck[:,None]
    effects*=effect_duck[:,None]
    # Editorial full-stop: keep the comedy line dry, without explosion tails.
    for start,end in spec.get('effects_silence',[]):
        i=max(0,round(start*RATE));j=min(samples,round(end*RATE))
        effects[i:j]=0
    premix=music+voice+effects
    render_float(OUT/f'{name}-music-ducked.wav',music)
    render_float(OUT/f'{name}-voices.wav',voice)
    render_float(OUT/f'{name}-effects.wav',effects)
    premix_path=OUT/f'{name}-premix.wav'
    render_float(premix_path,premix)
    probe=subprocess.run(['ffmpeg','-hide_banner','-nostats','-i',str(premix_path),'-af','loudnorm=I=-14:TP=-1.2:LRA=11:print_format=json','-f','null','-'],capture_output=True,text=True,check=True)
    match=re.search(r'\{\s*"input_i"[\s\S]*?\}',probe.stderr)
    levels=json.loads(match.group())
    normalize=(f'loudnorm=I=-14:TP=-1.2:LRA=11:measured_I={levels["input_i"]}'
      f':measured_TP={levels["input_tp"]}:measured_LRA={levels["input_lra"]}'
      f':measured_thresh={levels["input_thresh"]}:offset={levels["target_offset"]}'
      ':linear=true:print_format=json')
    master=OUT/f'roadster-trailer-{name}-{length:g}s.wav'
    final=subprocess.run(['ffmpeg','-hide_banner','-nostats','-y','-i',str(premix_path),'-af',normalize,'-ar',str(RATE),'-c:a','pcm_s24le',str(master)],capture_output=True,text=True,check=True)
    measure=re.search(r'\{\s*"input_i"[\s\S]*?\}',final.stderr)
    result=json.loads(measure.group()) if measure else {}
    preserved_intro = spec.get('preserve_intro')
    if preserved_intro:
        # Global loudness analysis changes slightly with a longer edit. Keep the
        # approved opening at its original mastered level, including every cue.
        # The brief transition starts after the preserved interval.
        source = ROOT / preserved_intro['source']
        old = decode(source)
        new = decode(master)
        preserve = min(len(old), len(new), round(float(preserved_intro['duration']) * RATE))
        transition = min(len(old) - preserve, len(new) - preserve, round(.05 * RATE))
        new[:preserve] = old[:preserve]
        if transition > 0:
            blend = np.linspace(0, 1, transition)[:, None]
            new[preserve:preserve + transition] = old[preserve:preserve + transition] * (1 - blend) + new[preserve:preserve + transition] * blend
        subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','f32le','-ar',str(RATE),'-ac','2','-i','-','-c:a','pcm_s24le',str(master)],input=new.astype('<f4').tobytes(),check=True)
        measured=subprocess.run(['ffmpeg','-hide_banner','-nostats','-i',str(master),'-af','loudnorm=I=-14:TP=-1.2:LRA=11:print_format=json','-f','null','-'],capture_output=True,text=True,check=True)
        result['preserved_intro_seconds'] = preserve / RATE
        final_levels=json.loads(re.search(r'\{\s*"input_i"[\s\S]*?\}',measured.stderr).group())
        result['final_integrated_lufs'] = final_levels['input_i']
        result['final_true_peak_dbtp'] = final_levels['input_tp']
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(master),'-c:a','aac','-b:a','320k',str(master.with_suffix('.m4a'))],check=True)
    report={'duration':length,'sample_rate':RATE,'channels':2,'premix_peak_dBFS':round(20*math.log10(max(1e-12,float(np.abs(premix).max()))),3),'master_measurements':result,'events':rendered}
    (OUT/f'{name}-mix-report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(master)
    print(json.dumps(result,indent=2))


if __name__=='__main__':
    main()
