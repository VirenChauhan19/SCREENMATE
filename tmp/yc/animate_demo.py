from pathlib import Path
import subprocess
import json
import re
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT=Path(__file__).resolve().parents[2]
TMP=ROOT/'tmp'/'yc'
OUT=ROOT/'output'/'yc'/'video'
FF=ROOT/'node_modules'/'ffmpeg-static'/'ffmpeg.exe'
SOURCE=ROOT/'demo'/'screenmate-demo.mp4'
FONT_DIR=Path('C:/Windows/Fonts')
FPS=30
TRANSITION=0.35
plan=json.loads((TMP/'final-edit-decisions.json').read_text())

def font(size,bold=False):
    return ImageFont.truetype(str(FONT_DIR/('segoeuib.ttf' if bold else 'segoeui.ttf')),size)

def run(args):
    subprocess.run([str(FF),'-hide_banner','-loglevel','error','-y']+list(map(str,args)),check=True)

def transparent(): return Image.new('RGBA',(1920,1080),(0,0,0,0))

# A subtle background glow; no synthetic product UI is introduced.
bg=Image.new('RGB',(1920,1080),'#101017')
glow=transparent(); gd=ImageDraw.Draw(glow)
gd.ellipse((1150,-330,2250,650),fill=(105,76,180,60))
gd.ellipse((-250,720,700,1450),fill=(49,48,95,45))
bg=Image.alpha_composite(bg.convert('RGBA'),glow.filter(ImageFilter.GaussianBlur(150)))
bg.save(TMP/'motion-background.png')

logo=transparent(); d=ImageDraw.Draw(logo)
d.rounded_rectangle((120,130,198,208),radius=17,fill='#8067ee')
d.text((141,135),'S',font=font(48,True),fill='white')
d.text((225,151),'SCREENMATE',font=font(30,True),fill='#c4bcf3')
logo.save(TMP/'motion-logo.png')

for label,title,subtitle,badge in [
    ('intro','Job applications, with less retyping','A product walkthrough by Viren Chauhan','3rd globally among 687 projects  |  AI Tinkerers hackathon with OpenAI'),
    ('outro','You review. You submit.','Save repeated work. Keep control of your answers.','Recorded prototype on a sample form  |  Edited for explanation')]:
    title_layer=transparent(); d=ImageDraw.Draw(title_layer)
    d.text((120,340),title,font=font(73,True),fill='white')
    d.text((125,465),subtitle,font=font(37),fill='#d3d2dd')
    title_layer.save(TMP/f'motion-{label}-title.png')
    badge_layer=transparent(); d=ImageDraw.Draw(badge_layer)
    d.rounded_rectangle((120,700,1775,795),radius=18,fill=(33,29,48,235),outline='#56487f',width=1)
    d.text((151,727),badge,font=font(27),fill='#ccc3e7')
    badge_layer.save(TMP/f'motion-{label}-badge.png')

clips=[]
for i,scene in enumerate(plan['scenes']):
    sid=scene['id']; duration=scene['duration']; dest=TMP/f'animated-{sid}.mp4'
    if sid in ('intro','outro'):
        inputs=['-loop','1','-i',TMP/'motion-background.png','-loop','1','-i',TMP/'motion-logo.png',
                '-loop','1','-i',TMP/f'motion-{sid}-title.png','-loop','1','-i',TMP/f'motion-{sid}-badge.png']
        graph=("[0:v]format=rgba,fps=30[bg];"
               "[1:v]format=rgba,fade=t=in:st=0:d=0.35:alpha=1[logo];"
               "[2:v]format=rgba,fade=t=in:st=0.12:d=0.48:alpha=1[title];"
               "[3:v]format=rgba,fade=t=in:st=0.55:d=0.45:alpha=1[badge];"
               "[bg][logo]overlay=x=0:y='14*pow(1-min(t/0.5,1),3)'[a];"
               "[a][title]overlay=x=0:y='38*pow(1-min(max((t-0.12)/0.7,0),1),3)'[b];"
               "[b][badge]overlay=x=0:y='22*pow(1-min(max((t-0.55)/0.6,0),1),3)',format=yuv420p,setsar=1[v]")
    else:
        base=transparent(); d=ImageDraw.Draw(base)
        d.rectangle((0,0,1920,62),fill='#101017')
        d.rectangle((0,922,1920,1080),fill='#101017')
        d.text((45,15),'SCREENMATE',font=font(23,True),fill='#d6cffb')
        d.text((1220,17),'Sample form  |  Edited prototype recording',font=font(21),fill='#c5c2d2')
        d.rounded_rectangle((164,60,1755,924),radius=3,outline='#34313f',width=2)
        base.save(TMP/f'animated-base-{sid}.png')
        label=transparent(); d=ImageDraw.Draw(label)
        d.text((48,934),scene['title'],font=font(29,True),fill='#c4bcf3')
        label.save(TMP/f'animated-label-{sid}.png')
        vstart,vend=scene['video']; factor=duration/(vend-vstart); frames=round(duration*FPS)
        inputs=['-i',SOURCE,'-loop','1','-i',TMP/f'animated-base-{sid}.png','-loop','1','-i',TMP/f'animated-label-{sid}.png']
        # Gentle camera push with a fixed upper-right focal area keeps the agent panel legible.
        z=f'1+0.04*(on/{frames})*(2-on/{frames})'
        graph=(f"[0:v]trim=start={vstart}:end={vend},setpts={factor:.9f}*(PTS-STARTPTS),fps=30,"
               "crop=1440:780:0:0,scale=3176:1720,"
               f"zoompan=z='{z}':x='(iw-iw/zoom)*0.76':y='(ih-ih/zoom)*0.36':d=1:s=1588x860:fps=30,"
               "pad=1920:1080:166:62:color=0x101017[screen];"
               "[screen][1:v]overlay=0:0[a];"
               "[2:v]format=rgba,fade=t=in:st=0.1:d=0.45:alpha=1[label];"
               "[a][label]overlay=x=0:y='20*pow(1-min(t/0.65,1),3)',format=yuv420p,setsar=1[v]")
    run([*inputs,'-filter_complex',graph,'-map','[v]','-an','-t',duration,'-r',FPS,
         '-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p',dest])
    clips.append(dest)
    print('Animated scene:',sid,flush=True)

inputs=[]; filters=[]
for i,clip in enumerate(clips):
    inputs+=['-i',clip]
    tail=TRANSITION if i<len(clips)-1 else 0
    filters.append(f'[{i}:v]fps=30,settb=AVTB,tpad=stop_mode=clone:stop_duration={tail},format=yuv420p[v{i}]')
last='v0'; boundary=0
for i in range(1,len(clips)):
    boundary+=plan['scenes'][i-1]['duration']
    out=f'blend{i}'
    filters.append(f'[{last}][v{i}]xfade=transition=fade:duration={TRANSITION}:offset={boundary:.4f}[{out}]')
    last=out
filters.append(f"[{last}]ass=tmp/yc/demo-captions.ass,fade=t=in:st=0:d=0.18,fade=t=out:st={plan['demo_seconds']-0.22:.3f}:d=0.22[v]")
# Apply audio leveling to the already edited human narration, without changing its timing or pitch.
inputs+=['-i',TMP/'narrated-assembled.mp4']
aud_idx=len(clips)
filters.append(f'[{aud_idx}:a]loudnorm=I=-16:TP=-2:LRA=11,aresample=48000[a]')
final=OUT/'Screenmate_Product_Demo_YC.mp4'
run([*inputs,'-filter_complex_threads','2','-filter_complex',';'.join(filters),'-map','[v]','-map','[a]',
     '-t',plan['demo_seconds'],'-r',FPS,'-c:v','libx264','-preset','slow','-crf','18','-pix_fmt','yuv420p',
     '-c:a','aac','-b:a','160k','-ar','48000','-ac','1','-movflags','+faststart',final])

# Finish the founder audio at the same level; preserve the continuous on-camera picture.
founder=OUT/'Screenmate_Founder_YC.mp4'
leveled=TMP/'founder-leveled.mp4'
run(['-i',founder,'-c:v','copy','-af','loudnorm=I=-16:TP=-2:LRA=11','-c:a','aac','-b:a','160k',
     '-ar','48000','-ac','1','-t','59.90','-movflags','+faststart',leveled])
founder.write_bytes(leveled.read_bytes())
run(['-i',final,'-vf','fps=1/3,scale=480:-1,tile=4x4','-frames:v','1','-update','1',TMP/'animated-contact.jpg'])
run(['-i',final,'-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',TMP/'demo-animated.wav'])
print('Animated product demo and leveled founder video complete',flush=True)
