const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = document.getElementById('results');
const status = document.getElementById('status');
const runButton = document.getElementById('run');
let passed = 0, failed = 0;
// Simulate the top-frame election response for the orchestration fixture.
window.addEventListener('message', event => {
  if (event.origin === location.origin && event.data?.__screenmate === 'screenmate:claim') {
    event.source.postMessage({ __screenmate: 'screenmate:youWon' }, location.origin);
  }
});
function check(name, ok) {
  const item = document.createElement('li');
  item.className = ok ? 'pass' : 'fail';
  item.textContent = `${ok ? 'PASS' : 'FAIL'}: ${name}`;
  results.append(item);
  if (ok) passed++; else failed++;
}
async function loadFixture(file) {
  const iframe = document.createElement('iframe');
  iframe.src = `/fixtures/${file}`;
  document.getElementById('stage').replaceChildren(iframe);
  await new Promise((resolve, reject) => { iframe.onload = resolve; iframe.onerror = reject; });
  let win = iframe.contentWindow;
  const embedded = win.document.querySelector('iframe');
  if (embedded) {
    if (!embedded.contentDocument?.querySelector('input')) await new Promise(resolve => embedded.onload = resolve);
    win = embedded.contentWindow;
  }
  for (const name of ['scan', 'act', 'nav']) {
    const script = win.document.createElement('script');
    script.src = `/extension/content/${name}.js`;
    win.document.body.append(script);
    await new Promise((resolve, reject) => { script.onload = resolve; script.onerror = reject; });
  }
  return win;
}
runButton.onclick = async () => {
  runButton.disabled = true; results.replaceChildren(); passed = 0; failed = 0; status.textContent = 'Running';
  try {
    const portals = [
      ['Greenhouse', 'portals/greenhouse.html', 8, [['Full name', 'Test Applicant'], ['Highest degree attained', 'BFA Game Design']]],
      ['Lever', 'portals/lever.html', 6, [['Full name', 'Test Applicant'], ['Will you require visa sponsorship?', 'No']]],
      ['Ashby', 'portals/ashby.html', 6, [['Name', 'Test Applicant'], ['School', 'SCAD'], ['Are you willing to relocate?', 'Yes']]],
      ['Taleo iframe', 'portals/taleo-host.html', 6, [['Full Name', 'Test Applicant'], ['Education Level', 'BFA Game Design']]],
      ['Workday', 'workday.html', 4, [['Full legal name', 'Test Applicant'], ['How did you hear about us?', 'LinkedIn']]],
    ];
    for (const [name, file, min, writes] of portals) {
      const win = await loadFixture(file);
      const scan = win.__screenmateScan, act = win.__screenmateAct;
      check(`${name}: detects application controls`, scan.scanFields().length >= min);
      for (const [label, value] of writes) {
        const field = scan.scanFields().find(f => f.label === label);
        const written = field && await act.applyWrite(field, value);
        check(`${name}: ${label} write verified`, Boolean(written?.ok && act.verifyWrite(field, value).ok));
      }
      if (name === 'Ashby') check('Ashby: suggestion actually selected', win.document.getElementById('a_school').dataset.confirmed === '1');
    }
    const win = await loadFixture('portals/edge-cases.html');
    const scan = win.__screenmateScan, act = win.__screenmateAct, nav = win.__screenmateNav, doc = win.document;
    const find = label => scan.scanFields().find(f => f.label === label);
    const fields = scan.scanFields();
    check('Repeated names and reserved suffixes have unique IDs', new Set(fields.map(f => f.id)).size === fields.length);
    check('IDs remain stable on a rescan', fields.map(f => f.id).join('|') === scan.scanFields().map(f => f.id).join('|'));
    check('Shadow ARIA label and required marker read', Boolean(find('Shadow email')?.required));
    check('Shadow native label read', Boolean(find('Shadow degree')));
    let shadowEventReceived = false;
    doc.addEventListener('input', event => {
      if (event.composedPath().some(node => node.id === 'email')) shadowEventReceived = true;
    });
    await act.applyWrite(find('Shadow email'), 'applicant@example.test');
    check('Shadow input event reaches framework outside root', shadowEventReceived);
    check('Ancestor-hidden field excluded', !fields.some(f => f.label.includes('Hidden salary')));
    check('Required unchecked consent remains incomplete', find('I agree to the privacy policy')?.value === '');
    check('Disabled select choices excluded without stripping valid Select names', find('Education').options.join('|') === 'Select Engineering College|SCAD');
    const education = find('Education');
    await act.applyWrite(education, 'SCAD');
    check('Native dropdown can restore its empty placeholder', (await act.applyWrite(education, '')).ok && scan.currentValue(education.el) === '');
    const radios = fields.filter(f => f.label.includes('sponsorship') || f.label.includes('Sponsorship'));
    check('Same radio name in separate forms stays separate', radios.length === 2);
    await act.applyWrite(radios[0], 'Yes');
    check('Radio write only affects its own form', doc.querySelector('#one input[type=radio]').checked && !doc.querySelector('#two input[type=radio]').checked);
    const shadow = find('Shadow degree');
    check('Shadow dropdown options readable', (await act.readOptions(shadow)).includes('BFA Game Design'));
    check('Shadow dropdown selection verified', (await act.applyWrite(shadow, 'BFA Game Design')).ok && act.verifyWrite(shadow, 'BFA Game Design').ok);
    const school = find('School');
    check('Delayed remote dropdown options selected', (await act.applyWrite(school, 'SCAD')).ok && doc.getElementById('school').dataset.selected === 'SCAD');
    check('Disabled dropdown option refused', !(await act.applyWrite(school, 'Disabled College')).ok);
    check('Unmatched dropdown restores original text', !(await act.applyWrite(school, 'SC')).ok && doc.getElementById('school').value === 'SCAD');
    check('Reading options preserves existing typeahead answer', (await act.readOptions(school), doc.getElementById('school').value === 'SCAD'));
    const notes = find('Notes');
    doc.getElementById('notes').value = 'Truncated';
    check('Partial text cannot pass verification', !act.verifyWrite(notes, 'Truncated answer').ok);
    const name = find('Full name');
    name.el.replaceWith(name.el.cloneNode());
    check('Framework replacement resolved before write', (await act.applyWrite(name, 'Test Applicant')).ok && act.verifyWrite(name, 'Test Applicant').ok);
    doc.getElementById('notes').parentElement.firstChild.textContent = 'Work authorization';
    check('Reused input with a new question requires rescan', !(await act.applyWrite(notes, 'Test answer')).ok);
    check('Apply and continue treated as submission', nav.isSubmitControl(doc.getElementById('submit')));
    const next = nav.findAdvanceControl();
    check('Safe Next found', next?.el.id === 'next');
    doc.getElementById('next').disabled = true;
    check('Disabled Next refused at action time', !(await nav.advance(next, { timeout: 500 })).ok);
    doc.getElementById('next').disabled = false;
    const moving = nav.advance(next, { timeout: 500 });
    doc.getElementById('next').textContent = 'Submit and continue';
    check('Next changed to Submit refused before click', !(await moving).ok);
    check('Final submit refused directly', !(await nav.advance({ el: doc.getElementById('submit') })).ok);
    const dynamic = await loadFixture('portals/dynamic.html');
    await delay(5700);
    check('Two-field application loaded after four seconds detected', Boolean(dynamic.document.getElementById('screenmate-root')));
    const automatic = await loadFixture('portals/automatic-dropdowns.html');
    await delay(800);
    automatic.document.querySelector('#screenmate-root button').click();
    for (let i = 0; i < 80 && !['reviewing', 'complete', 'error', 'waiting'].includes(automatic.document.getElementById('test-status').textContent); i++) await delay(100);
    check('Factual dropdown chosen automatically from profile', automatic.document.getElementById('degree').value === 'BFA Game Design');
    check('Saved dropdown answer matched to site wording', automatic.document.getElementById('sponsorship').value === 'No, I do not require sponsorship');
    check('Missing personal dropdown stays incomplete', automatic.__screenmateScan.scanFields().find(f => f.id === 'relocation').value === '');
    check('Dropdowns and incomplete standing preferences never interrupt run', automatic.document.getElementById('prompts').textContent === 'NO PROMPT' && automatic.document.getElementById('test-status').textContent === 'reviewing');
    const prefs = automatic.__screenmatePrefs;
    check('Saved phone number filled without a model question', automatic.document.getElementById('phone').value === '+1 202-555-0123');
    check('Phone device type defaults to Mobile without asking', automatic.document.getElementById('phoneType').value === 'Mobile');
    check('Phone category recognizes Cellular wording', prefs.profileOption({type:'select',label:'Phone type',options:['Home','Cellular','Work']},{}) === 'Cellular');
    check('Unrelated computer device question never defaults to Mobile', prefs.profileOption({type:'select',label:'Computer device type',options:['Desktop','Mobile']},{}) === null);
    check('Unlabeled phone category recognizes Work/Home choices', prefs.profileOption({type:'select',label:'Device Type',options:['Mobile','Home','Work']},{}) === 'Mobile');
    check('Ambiguous Mobile/Cell choices remain for review', prefs.profileOption({type:'select',label:'Phone type',options:['Mobile','Cell','Home']},{}) === null);
    check('Saved No never prefix-matches an unrelated option', prefs.matchOption('No', ['Not listed', 'No, I do not']) === 'No, I do not');
    check('Ambiguous saved Yes stays for review', prefs.matchOption('Yes', ['Yes, currently', 'Yes, in the future']) === null);
    check('Profile dropdown never chooses among several matching skills', prefs.profileOption({type:'select',label:'Primary skill',options:['React','Python']},{skills:['React','Python']}) === null);
    check('Degree matched to portal education category', prefs.profileOption({type:'select',label:'Highest level of education',options:["Bachelor's degree","Master's degree"]},{degree:'BFA Game Design'}) === "Bachelor's degree");
    check('Unknown qualification never invents a degree level', prefs.profileOption({type:'select',label:'Highest degree',options:["Bachelor's degree","Master's degree"]},{degree:'Design certification'}) === null);
  } catch (error) { check(`Unexpected error: ${error.message}`, false); }
  status.textContent = `${failed ? 'FAIL' : 'PASS'} — ${passed} passed, ${failed} failed`;
  runButton.disabled = false;
};
