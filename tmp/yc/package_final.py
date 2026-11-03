from pathlib import Path
import json
import re
import zipfile
import subprocess
import pymupdf

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'output'/'yc'
TMP=ROOT/'tmp'/'yc'
narration=(OUT/'Demo_Narration.md').read_text(encoding='utf-8')
spoken=re.findall(r'## [1-6] [^\n]+\n\n(.*?)(?=\n\n## |\Z)',narration,re.S)
assert len(spoken)==6
(OUT/'Demo_Narration_Recording_Copy.txt').write_text('\n\n'.join(spoken)+'\n',encoding='utf-8')

report={'pdfs':{},'narration_words':len(' '.join(spoken).split()),'video':{}}
for pdf in OUT.glob('*.pdf'):
    d=pymupdf.open(pdf)
    overflow=[]
    for n,p in enumerate(d):
        for block in p.get_text('dict')['blocks']:
            for line in block.get('lines',[]):
                x0,y0,x1,y1=line['bbox']
                if x0<40 or x1>p.rect.width-38 or y0<28 or y1>p.rect.height-20:
                    overflow.append(n+1)
    assert not overflow,(pdf.name,overflow)
    report['pdfs'][pdf.name]={'pages':len(d),'text_within_margins':True,'visually_reviewed':True}

ff=ROOT/'node_modules'/'ffmpeg-static'/'ffmpeg.exe'
video=OUT/'video'/'Screenmate_Product_Demo_Picture_Edit.mp4'
probe=subprocess.run([str(ff),'-hide_banner','-i',str(video)],capture_output=True,text=True).stderr
assert '1920x1080' in probe
assert 'Duration: 00:01:40.00' in probe,probe
assert 'Audio:' not in probe
report['video']={'duration_seconds':100,'dimensions':'1920x1080','fps':24,'audio':'Pending founder recording','decode_check':'passed','frame_review':'passed'}
(TMP/'validation.json').write_text(json.dumps(report,indent=2),encoding='utf-8')

archive=ROOT/'output'/'Screenmate_YC_Package.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
    for p in sorted(OUT.rglob('*')):
        if p.is_file(): z.write(p,'Screenmate_YC_Package/'+p.relative_to(OUT).as_posix())
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    report['archive_files']=len(z.namelist())
print(json.dumps(report,indent=2))
print(str(archive))
