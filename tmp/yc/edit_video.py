from pathlib import Path
import subprocess
import json

ROOT=Path(__file__).resolve().parents[2]
TMP=ROOT/'tmp'/'yc'
OUT=ROOT/'output'/'yc'/'video'
FF=ROOT/'node_modules'/'ffmpeg-static'/'ffmpeg.exe'
SOURCE=ROOT/'demo'/'screenmate-demo.mp4'

def run(args):
    subprocess.run([str(FF),'-hide_banner','-loglevel','error','-y']+list(map(str,args)),check=True)

encoding=['-r','24','-c:v','libx264','-preset','medium','-crf','19','-pix_fmt','yuv420p','-movflags','+faststart']
clips=[]
for name,duration in [('intro',8)]:
    dest=TMP/f'{name}-clip.mp4'
    run(['-loop','1','-i',TMP/f'{name}.png','-t',duration,*encoding,dest])
    clips.append(dest)
for beat in json.loads((TMP/'edit-plan.json').read_text()):
    dest=TMP/f"scene-{beat['id']}.mp4"
    ratio=beat['duration']/(beat['end']-beat['start'])
    filtergraph=(f"[0:v]trim=start={beat['start']}:end={beat['end']},setpts={ratio:.8f}*(PTS-STARTPTS),"
                 "crop=1440:780:0:0,scale=1588:860,pad=1920:1080:166:62:color=0x101017[base];"
                 "[base][1:v]overlay=0:0:format=auto,format=yuv420p[v]")
    run(['-i',SOURCE,'-loop','1','-i',TMP/f"overlay-{beat['id']}.png",'-filter_complex',filtergraph,
         '-map','[v]','-an','-t',beat['duration'],*encoding,dest])
    clips.append(dest)
    print('Encoded scene',beat['id'],flush=True)
dest=TMP/'outro-clip.mp4'
run(['-loop','1','-i',TMP/'outro.png','-t',5,*encoding,dest]); clips.append(dest)
listing=TMP/'concat.txt'
listing.write_text('\n'.join("file '"+p.as_posix()+"'" for p in clips),encoding='utf-8')
final=OUT/'Screenmate_Product_Demo_Picture_Edit.mp4'
run(['-f','concat','-safe','0','-i',listing,'-c','copy','-movflags','+faststart',final])
run(['-i',final,'-vf','fps=1/10,scale=480:-1,tile=4x3','-frames:v','1','-update','1',TMP/'edited-contact.jpg'])
print('Created',final,flush=True)
