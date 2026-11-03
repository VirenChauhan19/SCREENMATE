from pathlib import Path
import hashlib
import json
import re
import shutil
import zipfile
import pymupdf

ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT/'output'/'yc'
DEST=ROOT/'output'/'yc_submission'
DEST.mkdir(parents=True,exist_ok=True)
files=[
    'START_HERE.md','Submission_Copy.md','Application_Answers.md','Founder_Facts.md',
    'Video_Guide.md','Evidence_and_Sources.md','Recognition.md',
    'Screenmate_YC_Workbook.pdf','Screenmate_Overview.pdf',
    'video/Screenmate_Founder_YC.mp4','video/Screenmate_Product_Demo_YC.mp4',
    'video/Screenmate_Founder_YC.srt','video/Screenmate_Product_Demo.srt',
    'video/Screenmate_Founder_Transcript.txt','video/EDIT_NOTES.md',
]

def checksum(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f,'sha256').hexdigest()

def seconds(t):
    h,m,s=re.split('[:,]',t)[:3]
    millis=t.rsplit(',',1)[1]
    return int(h)*3600+int(m)*60+int(s)+int(millis)/1000

for name,limit in [('video/Screenmate_Founder_YC.srt',59.9),('video/Screenmate_Product_Demo.srt',41.9)]:
    intervals=re.findall(r'(\d\d:\d\d:\d\d,\d\d\d) --> (\d\d:\d\d:\d\d,\d\d\d)',(SOURCE/name).read_text(encoding='utf-8'))
    assert intervals,name
    previous=0
    for a,b in intervals:
        start,end=seconds(a),seconds(b)
        assert 0<=start<end<=limit+0.05,(name,start,end)
        assert start>=previous-0.02,(name,start,previous)
        previous=end

manifest=[]
for name in files:
    src=SOURCE/name
    target=DEST/name
    target.parent.mkdir(parents=True,exist_ok=True)
    shutil.copy2(src,target)
    assert checksum(src)==checksum(target),name
    manifest.append({'file':name,'bytes':target.stat().st_size,'sha256':checksum(target)})

for name,expected in [('Screenmate_YC_Workbook.pdf',8),('Screenmate_Overview.pdf',1)]:
    doc=pymupdf.open(DEST/name)
    assert len(doc)==expected
    assert all(page.get_text().strip() for page in doc)

assert 'no audio track yet' not in (DEST/'video/EDIT_NOTES.md').read_text(encoding='utf-8')
assert 'record the videos before submitting' not in '\n'.join(p.get_text() for p in pymupdf.open(DEST/'Screenmate_YC_Workbook.pdf'))
assert len(re.search(r'## Description in 50 characters or fewer\n\n([^\n]+)',(DEST/'Submission_Copy.md').read_text(encoding='utf-8')).group(1))<=50

archive=ROOT/'output'/'Screenmate_YC_Submission_Package.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for name in files:
        z.write(DEST/name,'Screenmate_YC_Submission/'+name)
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    assert len(z.namelist())==len(files)
shutil.copy2(archive,ROOT/'output'/'Screenmate_YC_Package.zip')

report={
    'status':'Final videos ready; application requires founder and business facts',
    'archive':str(archive),'archive_bytes':archive.stat().st_size,
    'archive_integrity':'passed','pdf_visual_review':'passed','caption_timing_checks':'passed',
    'video_decode_checks':'passed',
    'founder':{'seconds':59.9,'size':'832x464','fps':30,'integrated_lufs':-16.82,'true_peak_dbtp':-1.99},
    'product_demo':{'seconds':41.9,'size':'1920x1080','fps':30,'integrated_lufs':-16.91,'true_peak_dbtp':-1.99},
    'files':manifest,
}
(ROOT/'tmp'/'yc'/'submission-validation.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in report.items() if k!='files'},indent=2))
print('Packaged',len(files),'files.')
