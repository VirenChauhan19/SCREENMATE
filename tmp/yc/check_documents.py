from pathlib import Path
import json
import pymupdf
from PIL import Image, ImageOps, ImageDraw

root=Path(__file__).resolve().parents[2]
out=root/'output'/'yc'
tmp=root/'tmp'/'yc'
report={}
thumbs=[]
for pdf in sorted(out.glob('*.pdf')):
    doc=pymupdf.open(pdf)
    pages=[]
    for i,page in enumerate(doc):
        text=page.get_text()
        violations=[]
        for block in page.get_text('dict')['blocks']:
            for line in block.get('lines',[]):
                x0,y0,x1,y1=line['bbox']
                if x0<40 or x1>page.rect.width-38 or y0<28 or y1>page.rect.height-20:
                    violations.append(line['bbox'])
        assert not violations,(pdf.name,i+1,violations)
        pages.append({'page':i+1,'first_text':text[:105].replace('\n',' '),'words':len(text.split())})
        im=Image.open(tmp/pdf.stem/f'page-{i+1:02}.png').convert('RGB')
        im.thumbnail((510,660))
        tile=Image.new('RGB',(530,700),'#e8e8eb')
        tile.paste(im,((530-im.width)//2,25))
        ImageDraw.Draw(tile).text((12,680),f'{pdf.stem} / {i+1}',fill='black')
        thumbs.append(tile)
    report[pdf.name]=pages
contact=Image.new('RGB',(530*3,700*((len(thumbs)+2)//3)),'#c9c9d0')
for i,tile in enumerate(thumbs):
    contact.paste(tile,((i%3)*530,(i//3)*700))
contact.save(tmp/'final-documents-contact.jpg',quality=90)
(tmp/'document-validation.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report,indent=2))
