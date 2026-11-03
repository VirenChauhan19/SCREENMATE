from pathlib import Path
import subprocess
import json
import re
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parents[2]
TMP=ROOT/'tmp'/'yc'
OUT=ROOT/'output'/'yc'/'video'
FF=ROOT/'node_modules'/'ffmpeg-static'/'ffmpeg.exe'
SOURCE=Path('C:/Users/chauh/Downloads/Screenmate.mp4')
DEMO=ROOT/'demo'/'screenmate-demo.mp4'
FINAL_SECONDS=59.90
FONT_DIR=Path('C:/Windows/Fonts')

def font(size,bold=False):
    return ImageFont.truetype(str(FONT_DIR/('segoeuib.ttf' if bold else 'segoeui.ttf')),size)

def run(args,capture=False):
    p=subprocess.run([str(FF),'-hide_banner','-loglevel','error','-y']+list(map(str,args)),capture_output=capture,text=capture,check=True)
    return p

def analyze_filter(source,filters,seconds=None):
    args=[str(FF),'-hide_banner','-i',str(source)]
    if seconds: args+=['-t',str(seconds)]
    args+=['-vn','-af',filters+',loudnorm=I=-16:TP=-2:LRA=11:print_format=json','-f','null','-']
    p=subprocess.run(args,capture_output=True,text=True,check=True)
    found=re.findall(r'\{\s*"input_i".*?\}',p.stderr,re.S)
    return json.loads(found[-1])

def loud_filter(stats):
    return ('loudnorm=I=-16:TP=-2:LRA=11:measured_I='+stats['input_i']+
            ':measured_TP='+stats['input_tp']+':measured_LRA='+stats['input_lra']+
            ':measured_thresh='+stats['input_thresh']+':offset='+stats['target_offset']+
            ':linear=true:print_format=summary')

base_audio='highpass=f=70,afftdn=nr=5:nf=-42:tn=1'
stats=analyze_filter(SOURCE,base_audio,FINAL_SECONDS)
(TMP/'founder-audio-analysis.json').write_text(json.dumps(stats,indent=2))
audio_filter=base_audio+','+loud_filter(stats)+',afade=t=in:st=0:d=0.025,afade=t=out:st=59.83:d=0.07'
clean=TMP/'founder-clean.wav'
run(['-i',SOURCE,'-t',FINAL_SECONDS,'-vn','-af',audio_filter,'-ar',48000,'-ac',1,'-c:a','pcm_s24le',clean])
founder=OUT/'Screenmate_Founder_YC.mp4'
run(['-i',SOURCE,'-i',clean,'-map','0:v:0','-map','1:a:0','-t',FINAL_SECONDS,
     '-vf','fps=30,eq=contrast=1.02:brightness=0.003:saturation=0.98',
     '-c:v','libx264','-preset','slow','-crf','18','-pix_fmt','yuv420p',
     '-c:a','aac','-b:a','160k','-ar','48000','-ac','1','-movflags','+faststart',founder])
print('Founder video exported',flush=True)

words=[w for s in json.loads((TMP/'founder-source-transcript.json').read_text()) for w in s['words']]
# Correct recognition errors in names and words that match the supplied reading script.
fixes={'openAI.':'OpenAI.','safe':'saved','plays':'placed','reparative':'repetitive','US':'U.S.','agents':'Agents'}
for w in words:
    raw=w['word'].strip()
    w['word']=fixes.get(raw,raw)
    if raw=='build' and 15<w['start']<16: w['word']='built'
    if raw=='job' and 5<w['start']<6: w['word']='jobs'

def clock(t,ass=False):
    if ass:
        cs=round(t*100); return f'{cs//360000}:{cs//6000%60:02}:{cs//100%60:02}.{cs%100:02}'
    ms=round(t*1000); return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'

def cues_for(ws,duration):
    groups=[]; group=[]
    for w in ws:
        if group and (len(' '.join(x['word'] for x in group))+len(w['word'])>72 or w['end']-group[0]['start']>4.0):
            groups.append(group); group=[]
        group.append(w)
        if w['word'].endswith(('.',',','?')) and len(group)>=4:
            groups.append(group); group=[]
    if group: groups.append(group)
    cues=[]
    for i,g in enumerate(groups):
        start=max(0,g[0]['start']); end=min(duration,g[-1]['end']+0.12)
        if i+1<len(groups): end=min(end,groups[i+1][0]['start'])
        text=' '.join(x['word'] for x in g)
        if end>start: cues.append({'start':start,'end':end,'text':text})
    return cues

def srt_file(path,cues):
    path.write_text('\n\n'.join(f"{i+1}\n{clock(c['start'])} --> {clock(c['end'])}\n{c['text']}" for i,c in enumerate(cues))+'\n',encoding='utf-8')

founder_cues=cues_for(words,FINAL_SECONDS)
srt_file(OUT/'Screenmate_Founder_YC.srt',founder_cues)
(OUT/'Screenmate_Founder_Transcript.txt').write_text(' '.join(w['word'] for w in words)+'\n',encoding='utf-8')

def card(path,title,subtitle,foot):
    im=Image.new('RGB',(1920,1080),'#101017'); d=ImageDraw.Draw(im)
    d.rounded_rectangle((120,130,198,208),radius=17,fill='#8067ee')
    d.text((141,135),'S',font=font(48,True),fill='white')
    d.text((225,151),'SCREENMATE',font=font(30,True),fill='#c4bcf3')
    d.text((120,340),title,font=font(73,True),fill='white')
    d.text((125,465),subtitle,font=font(37),fill='#d3d2dd')
    d.text((125,745),foot,font=font(28),fill='#b9b2d5')
    im.save(path)

card(TMP/'narrated-intro.png','Job applications, with less retyping','A product walkthrough by Viren Chauhan',
     '3rd globally among 687 projects  |  AI Tinkerers hackathon with OpenAI')
card(TMP/'narrated-outro.png','You review. You submit.','Save repeated work. Keep control of your answers.',
     'Recorded prototype on a sample form  |  Edited for explanation')

scenes=[
    {'id':'intro','duration':4.20,'audio':[0.0,3.97],'card':'narrated-intro.png','title':'Screenmate'},
    {'id':'problem','duration':7.00,'audio':[4.43,10.96],'video':[7.5,14.0],'title':'The application stays in view'},
    {'id':'context','duration':4.00,'audio':[11.28,14.45],'video':[28.0,44.0],'title':'Read what the form needs'},
    {'id':'details','duration':7.00,'audio':[29.88,33.96],'video':[44.0,73.0],'title':'Fill details from the saved profile'},
    {'id':'verify','duration':5.20,'audio':[34.30,37.40],'video':[73.0,84.0],'title':'Draft answers and verify changes'},
    {'id':'personal','duration':6.50,'audio':[37.55,41.45],'video':[84.0,100.0],'title':'Personal decisions stay with the applicant'},
    {'id':'review','duration':5.00,'audio':[52.92,57.92],'video':[100.0,104.0],'title':'Review before submission'},
    {'id':'outro','duration':3.00,'audio':[57.92,59.90],'card':'narrated-outro.png','title':'You review and submit'},
]
clips=[]; demo_words=[]; offset=0
for scene in scenes:
    sid=scene['id']; duration=scene['duration']; a,b=scene['audio']
    if 'card' not in scene:
        overlay=Image.new('RGBA',(1920,1080),(0,0,0,0)); d=ImageDraw.Draw(overlay)
        d.rectangle((0,0,1920,62),fill='#101017')
        d.text((45,15),'SCREENMATE',font=font(23,True),fill='#d6cffb')
        d.text((1220,17),'Sample form  |  Edited prototype recording',font=font(21),fill='#c5c2d2')
        d.rectangle((0,922,1920,1080),fill='#101017')
        d.text((48,934),scene['title'],font=font(29,True),fill='#c4bcf3')
        overlay.save(TMP/f'narrated-overlay-{sid}.png')
    dest=TMP/f'narrated-{sid}.mp4'
    if 'card' in scene:
        inputs=['-loop','1','-i',TMP/scene['card'],'-i',clean]
        graph=f'[0:v]scale=1920:1080,setsar=1[v];[1:a]atrim=start={a}:end={b},asetpts=PTS-STARTPTS,apad=whole_dur={duration}[a]'
    else:
        vstart,vend=scene['video']; factor=duration/(vend-vstart)
        inputs=['-i',DEMO,'-loop','1','-i',TMP/f'narrated-overlay-{sid}.png','-i',clean]
        graph=(f'[0:v]trim=start={vstart}:end={vend},setpts={factor:.8f}*(PTS-STARTPTS),'
               'crop=1440:780:0:0,scale=1588:860,pad=1920:1080:166:62:color=0x101017[base];'
               '[base][1:v]overlay=0:0:format=auto,format=yuv420p,setsar=1[v];'
               f'[2:a]atrim=start={a}:end={b},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.008,'
               f'afade=t=out:st={max(0,b-a-0.008):.4f}:d=0.008,apad=whole_dur={duration}[a]')
    run([*inputs,'-filter_complex',graph,'-map','[v]','-map','[a]','-t',duration,'-r','30',
         '-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p',
         '-c:a','aac','-b:a','160k','-ar','48000','-ac','1',dest])
    clips.append(dest)
    for w in words:
        # Keep words whose midpoint lies inside this audio selection.
        mid=(w['start']+w['end'])/2
        if a<=mid<b:
            demo_words.append({'word':w['word'],'start':max(offset,offset+w['start']-a),'end':min(offset+duration,offset+w['end']-a)})
    scene['output_start']=offset; offset+=duration
    print('Demo scene exported:',sid,flush=True)

listing=TMP/'narrated-concat.txt'
listing.write_text('\n'.join("file '"+p.as_posix()+"'" for p in clips),encoding='utf-8')
assembled=TMP/'narrated-assembled.mp4'
run(['-f','concat','-safe','0','-i',listing,'-c','copy','-movflags','+faststart',assembled])
demo_cues=cues_for(demo_words,offset)
srt_file(OUT/'Screenmate_Product_Demo.srt',demo_cues)

ass=['[Script Info]','ScriptType: v4.00+','PlayResX: 1920','PlayResY: 1080','WrapStyle: 0',
     '[V4+ Styles]','Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding',
     'Style: Default,Segoe UI,33,&H00FFFFFF,&H000000FF,&H00101017,&H00101017,0,0,0,0,100,100,0,0,1,1,0,2,80,80,29,1',
     '[Events]','Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text']
for c in demo_cues:
    ass.append(f"Dialogue: 0,{clock(c['start'],True)},{clock(c['end'],True)},Default,,0,0,0,,{c['text']}")
(TMP/'demo-captions.ass').write_text('\n'.join(ass),encoding='utf-8-sig')
final=OUT/'Screenmate_Product_Demo_YC.mp4'
run(['-i',assembled,'-vf','ass=tmp/yc/demo-captions.ass','-t',offset,
     '-c:v','libx264','-preset','slow','-crf','18','-pix_fmt','yuv420p',
     '-c:a','aac','-b:a','160k','-ar','48000','-ac','1','-movflags','+faststart',final])
(TMP/'final-edit-decisions.json').write_text(json.dumps({'founder_seconds':FINAL_SECONDS,'demo_seconds':offset,'scenes':scenes},indent=2))
run(['-i',founder,'-vf','fps=1/6,scale=416:-1,tile=4x3','-frames:v','1','-update','1',TMP/'founder-final-contact.jpg'])
run(['-i',final,'-vf','fps=1/4,scale=480:-1,tile=4x3','-frames:v','1','-update','1',TMP/'demo-final-contact.jpg'])
run(['-i',founder,'-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',TMP/'founder-final.wav'])
run(['-i',final,'-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',TMP/'demo-final.wav'])
print('Exported final founder and narrated product demo',flush=True)
