from pathlib import Path
import re
import html
import json
import subprocess
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, KeepTogether
from PIL import Image, ImageDraw, ImageFont
import fitz

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'output' / 'yc'
TMP = ROOT / 'tmp' / 'yc'
VIDEO = OUT / 'video'
VIDEO.mkdir(exist_ok=True)

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='DocTitle', fontName='Helvetica-Bold', fontSize=25, leading=29, spaceAfter=17, textColor=colors.black))
styles.add(ParagraphStyle(name='SectionTitle', fontName='Helvetica-Bold', fontSize=14, leading=18, spaceBefore=15, spaceAfter=7, keepWithNext=True, textColor=colors.black))
styles.add(ParagraphStyle(name='Copy', fontName='Helvetica', fontSize=10.4, leading=14.6, spaceAfter=8, textColor=colors.HexColor('#24242b')))
styles.add(ParagraphStyle(name='Pending', parent=styles['Copy'], textColor=colors.HexColor('#8a440c')))
styles.add(ParagraphStyle(name='BulletCopy', parent=styles['Copy'], leftIndent=13, firstLineIndent=-9, spaceAfter=5))
styles.add(ParagraphStyle(name='SmallCopy', parent=styles['Copy'], fontSize=9, leading=12.6, textColor=colors.HexColor('#55555f')))
styles.add(ParagraphStyle(name='SourceCopy', parent=styles['Copy'], fontSize=9.7, leading=13.2, spaceAfter=6))
styles.add(ParagraphStyle(name='SourceBullet', parent=styles['BulletCopy'], fontSize=9.7, leading=13.2, spaceAfter=4))
styles.add(ParagraphStyle(name='SourceHeading', parent=styles['SectionTitle'], fontSize=13, leading=16, spaceBefore=12, spaceAfter=6))

def markup(text):
    text = html.escape(text)
    text = re.sub(r'\*\*(.*?)\*\*', r'<b>\1</b>', text)
    text = re.sub(r'`(.*?)`', r'<font name="Courier">\1</font>', text)
    text = re.sub(r'(https?://[^\s<>]+)', r'<link href="\1" color="#443b80">\1</link>', text)
    return text

def parse_md(path, skip_first=False):
    items = []
    source = path.name == 'Evidence_and_Sources.md'
    for block in re.split(r'\n\s*\n', path.read_text(encoding='utf-8').strip()):
        if block.startswith('# '):
            if not skip_first:
                items.append(Paragraph(markup(block[2:].strip()), styles['DocTitle']))
            continue
        if block.startswith('## '):
            items.append(Paragraph(markup(block[3:].strip()), styles['SourceHeading' if source else 'SectionTitle']))
            continue
        if all(re.match(r'^(?:-|\d+\.) ', line) for line in block.splitlines()):
            for line in block.splitlines():
                items.append(Paragraph(markup(line), styles['SourceBullet' if source else 'BulletCopy']))
        else:
            text = ' '.join(block.splitlines())
            style = 'Pending' if text.startswith('[FOUNDER INPUT') or text.startswith('PROPOSED') else 'Copy'
            if source: style = 'SourceCopy'
            items.append(Paragraph(markup(text), styles[style]))
    return items

def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont('Helvetica', 8)
    canvas.setFillColor(colors.HexColor('#65656d'))
    canvas.drawString(50, 29, 'SCREENMATE  |  YC application preparation  |  November 2, 2026')
    canvas.drawRightString(562, 29, str(doc.page))
    canvas.restoreState()

def doc(path, story, footer_fn=footer):
    SimpleDocTemplate(str(path), pagesize=letter, rightMargin=50, leftMargin=50,
                      topMargin=47, bottomMargin=48, title=path.stem.replace('_',' '),
                      author='Screenmate', subject='Y Combinator application preparation').build(
                          story, onFirstPage=footer_fn, onLaterPages=footer_fn)

story = [Paragraph('Screenmate YC application workbook', styles['DocTitle']),
         Paragraph('Final videos and an editable application worksheet', styles['SectionTitle']),
         Paragraph('The founder video and animated product demo are finished. Add your founder and business facts and approve the proposed business plans before submitting the online application. Brown text identifies information or decisions that still need you.', styles['Copy']),
         Paragraph('Deadline and application', styles['SectionTitle']),
         Paragraph('YC lists the Winter 2027 on-time deadline as November 2, 2026 at 8 p.m. Pacific, or 11 p.m. Eastern. Late applications are still considered. The batch runs January to March in San Francisco. Check the current application page before submitting.', styles['Copy']),
         Paragraph(markup('https://www.ycombinator.com/apply'), styles['Copy']),
         Paragraph('Complete the package', styles['SectionTitle'])]
for text in [
    '1. Complete the founder facts and review the application answers. Replace every FOUNDER INPUT marker and confirm or replace every PROPOSED plan.',
    '2. Review the 59.90-second founder video and 41.90-second animated product demo with sound. Both use your own voice. If there are other founders, they must also appear in the founder video.',
    '3. Use Submission_Copy.md for concise product answers. Complete the remaining founder, traction, revenue, incorporation, ownership, and funding fields accurately.',
    '4. Upload both finished videos in the form or through the hosting method it accepts. Test any links while signed out.',
    '5. Paste the answers into the live form, complete conditional fields and founder profiles, check all facts and links, then submit and save the confirmation.'
]:
    story.append(Paragraph(text, styles['BulletCopy']))
story += [Paragraph('How to use these documents', styles['SectionTitle']),
          Paragraph('The editable Markdown files contain the same preparation material. Screenmate Overview is optional supporting material. The current signed-in form controls exact question wording, limits, and required attachments; it has not been inspected for this package. Nothing has been sent to YC.', styles['Copy']),
          Paragraph('Video scope', styles['SectionTitle']),
          Paragraph('The product footage shows a previous execution of the extension on a controlled sample application. It is edited for clarity and is not a timing benchmark, a live employer submission, or proof of current compatibility across application portals.', styles['Copy'])]
for filename in ['Application_Answers.md','Founder_Facts.md','Video_Guide.md','Evidence_and_Sources.md']:
    story.append(Spacer(1, 16) if filename == 'Founder_Facts.md' else PageBreak())
    story.extend(parse_md(OUT / filename))
doc(OUT / 'Screenmate_YC_Workbook.pdf', story)

overview = [Paragraph('Screenmate', styles['DocTitle']),
            Paragraph('An assistant for completing job applications', styles['SectionTitle']),
            Paragraph('Screenmate is a Chrome extension that fills saved details and drafts written answers directly on an application page. It checks whether its changes reached the form and leaves the applicant in control of review and submission.', styles['Copy']),
            Paragraph('The problem', styles['SectionTitle']),
            Paragraph('Job seekers repeatedly enter their education, experience, and contact details into different portals. Role-specific questions add writing work, and moving between a form and a separate AI chat requires copying both context and answers.', styles['Copy']),
            Paragraph('The workflow', styles['SectionTitle'])]
for text in [
    '1. Save a profile or import a CV and review the extracted information.',
    '2. Open an application. Screenmate reads supported fields, fills saved details, and drafts answers using the applicant background and role context.',
    '3. Inspect changes, answer missing personal questions, and submit the application yourself.'
]:
    overview.append(Paragraph(text, styles['BulletCopy']))
overview += [Paragraph('Implemented today', styles['SectionTitle']),
             Paragraph('The repository contains the extension, a web profile workspace, field verification, supported in-page navigation, and a separate review of generated personal claims. A recorded prototype demonstration shows the extension running on a controlled sample form.', styles['Copy']),
             Paragraph('Current boundaries', styles['SectionTitle']),
             Paragraph('Sign-in, CAPTCHAs, file uploads, unsupported controls, and final submission require user involvement. Compatibility depends on the employer form. Live-site reliability, customer demand, and willingness to pay remain to be established with measured evidence.', styles['Copy']),
             Paragraph('Hackathon recognition', styles['SectionTitle']),
             Paragraph('Screenmate placed third globally out of 687 projects at AI Tinkerers\' Agents Everywhere Hackathon with OpenAI. Built by Viren Chauhan, it represented Atlanta, the only U.S. chapter among the top three. This is external recognition of the build; user traction is a separate measure.', styles['Copy']),
             Paragraph(markup('https://virenchauhan.com/projects/screenmate'), styles['SmallCopy'])]
doc(OUT / 'Screenmate_Overview.pdf', overview)

for pdf in OUT.glob('*.pdf'):
    d = fitz.open(pdf)
    target = TMP / pdf.stem
    target.mkdir(exist_ok=True)
    for i, page in enumerate(d):
        page.get_pixmap(matrix=fitz.Matrix(1.35,1.35), alpha=False).save(target / f'page-{i+1:02}.png')
    print(f'{pdf.name}: {len(d)} pages')

FONT_DIR = Path('C:/Windows/Fonts')
def font(size, bold=False):
    return ImageFont.truetype(str(FONT_DIR / ('segoeuib.ttf' if bold else 'segoeui.ttf')), size)

def card(path, eyebrow, title, lines, foot):
    im = Image.new('RGB', (1920,1080), '#101017')
    draw = ImageDraw.Draw(im)
    draw.rounded_rectangle((120,130,198,208), radius=17, fill='#8067ee')
    draw.text((141,135), 'S', font=font(48,True), fill='white')
    draw.text((225,150), eyebrow, font=font(29,True), fill='#c4bcf3')
    draw.text((120,330), title, font=font(78,True), fill='white')
    for i,line in enumerate(lines):
        draw.text((125,460+i*70),line,font=font(39),fill='#d3d2dd')
    draw.text((125,930),foot,font=font(26),fill='#a9a6b9')
    im.save(path)

card(TMP/'intro.png','SCREENMATE','Job applications, with less retyping',
     ['Save your background. Fill the form.', 'Review the answers before you submit.'],
     'Product walkthrough  |  Recorded on a controlled sample form')
card(TMP/'outro.png','SCREENMATE','You review. You submit.',
     ['Screenmate handles repeated form work.', 'Personal decisions stay with the applicant.'],
     'Prototype demonstration  |  Edited for clarity; not a speed benchmark')

beats = [
    {'id':'01','title':'Read the application','caption':'See what the form needs, alongside the assistant.','start':7.5,'end':44.0,'duration':14},
    {'id':'02','title':'Fill saved details','caption':'Use profile facts and check each change on the page.','start':44.0,'end':60.0,'duration':18},
    {'id':'03','title':'Continue through the form','caption':'Read the next step and draft role-specific answers.','start':60.0,'end':84.0,'duration':20},
    {'id':'04','title':'Keep personal decisions with the user','caption':'Use saved preferences and ask for missing choices.','start':84.0,'end':99.0,'duration':22},
    {'id':'05','title':'Review before submission','caption':'The Submit button remains yours.','start':99.0,'end':104.0,'duration':13},
]
for beat in beats:
    im=Image.new('RGBA',(1920,1080),(0,0,0,0)); draw=ImageDraw.Draw(im)
    draw.rectangle((0,0,1920,62),fill='#101017')
    draw.text((45,15),'SCREENMATE',font=font(23,True),fill='#d6cffb')
    draw.text((1215,17),'Sample form  |  Edited prototype recording',font=font(21),fill='#c5c2d2')
    draw.rectangle((0,922,1920,1080),fill='#101017')
    draw.text((48,942),beat['title'],font=font(32,True),fill='white')
    draw.text((48,993),beat['caption'],font=font(28),fill='#c5c2d2')
    im.save(TMP/f"overlay-{beat['id']}.png")
(TMP/'edit-plan.json').write_text(json.dumps(beats,indent=2),encoding='utf-8')

description = re.search(r'## Company description in 50 characters or fewer\n\n([^\n]+)',(OUT/'Application_Answers.md').read_text()).group(1)
assert len(description)<=50, len(description)
print('One-line description:',len(description),'characters')
print('Video cards and overlays ready')
