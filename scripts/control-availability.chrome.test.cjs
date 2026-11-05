const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

// Exercise native browser disabled/visibility semantics with the real scanner
// and writer. No employer pages, backend credentials or model calls are needed.
test('Chrome rejects unavailable application controls', async t => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-first-run', '--no-default-browser-check'],
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  async function fixture(html, evaluate) {
    await page.goto('about:blank');
    await page.setContent(`<h1>Application</h1><form>${html}</form>`);
    for (const file of ['scan.js', 'act.js']) {
      await page.addScriptTag({path: path.join(__dirname, '../extension/content', file)});
    }
    return page.evaluate(evaluate);
  }

  await t.test('fieldset disabling excludes descendants while preserving the first legend exception', async () => {
    const result = await fixture(`<fieldset disabled>
      <legend><label>Full name<input id="legendName" name="name"></label></legend>
      <label>University<input id="university" name="university" required></label>
      <label>Degree<select id="degree"><option>Bachelor's degree</option></select></label>
      <label>Experience<textarea id="experience"></textarea></label>
    </fieldset>`, () => ({
      ids: window.__screenmateScan.scanFields().map(field => field.id),
      disabled: document.getElementById('university').matches(':disabled'),
      legendDisabled: document.getElementById('legendName').matches(':disabled'),
    }));
    assert.equal(result.disabled, true);
    assert.equal(result.legendDisabled, false);
    assert.deepEqual(result.ids, ['legendName']);
  });

  await t.test('a field disabled after scanning receives no write or success verification', async () => {
    const result = await fixture('<fieldset id="education"><label>University<input id="university" name="university" required></label></fieldset>', async () => {
      const field = window.__screenmateScan.scanFields()[0];
      let changes = 0;
      field.el.addEventListener('change', () => changes++);
      document.getElementById('education').disabled = true;
      const write = await window.__screenmateAct.applyWrite(field, 'Test University', {automatic: true});
      return {ok: write.ok, value: field.el.value, changes, verified: window.__screenmateAct.verifyWrite(field, 'Test University').ok};
    });
    assert.deepEqual(result, {ok: false, value: '', changes: 0, verified: false});
  });

  await t.test('a hidden duplicate radio never takes the visible choice or submitted value', async () => {
    const result = await fixture(`<fieldset><legend>Highest degree</legend>
      <div hidden><label><input type="radio" name="degree" value="obsolete">Bachelor's degree</label></div>
      <label><input type="radio" name="degree" value="high">High school</label>
      <label><input id="bachelor" type="radio" name="degree" value="bachelor">Bachelor's degree</label>
    </fieldset>`, async () => {
      const field = window.__screenmateScan.scanFields()[0];
      const write = await window.__screenmateAct.applyWrite(field, "Bachelor's degree", {automatic: true});
      return {options: field.options, ok: write.ok, visibleSelected: document.getElementById('bachelor').checked,
        submitted: new FormData(document.querySelector('form')).get('degree'),
        verified: window.__screenmateAct.verifyWrite(field, "Bachelor's degree").ok};
    });
    assert.deepEqual(result, {options: ['High school', "Bachelor's degree"], ok: true, visibleSelected: true, submitted: 'bachelor', verified: true});
  });

  await t.test('hidden and disabled native radio options cannot be written or verified', async () => {
    for (const unavailable of ['hidden', 'style="display:none"', 'aria-hidden="true"', 'aria-disabled="true"']) {
      const result = await fixture(`<fieldset><legend>Highest degree</legend>
        <div ${unavailable}><label><input id="unavailable" type="radio" name="degree" value="obsolete">Obsolete degree</label></div>
        <label><input type="radio" name="degree" value="high">High school</label>
      </fieldset>`, async () => {
        const field = window.__screenmateScan.scanFields()[0];
        const el = document.getElementById('unavailable');
        let clicks = 0;
        el.addEventListener('click', () => clicks++);
        const write = await window.__screenmateAct.applyWrite(field, 'Obsolete degree', {automatic: true});
        // Even a pre-existing hidden selection must not verify as a visible answer.
        el.checked = true;
        return {options: field.options, ok: write.ok, clicks, verified: window.__screenmateAct.verifyWrite(field, 'Obsolete degree').ok};
      });
      assert.deepEqual(result, {options: ['High school'], ok: false, clicks: 0, verified: false}, unavailable);
    }
  });

  await t.test('native radio options disabled by a nested fieldset are excluded', async () => {
    const result = await fixture(`<fieldset><legend>Highest degree</legend>
      <fieldset disabled><label><input type="radio" name="degree" value="obsolete">Obsolete degree</label></fieldset>
      <label><input type="radio" name="degree" value="high">High school</label>
    </fieldset>`, async () => {
      const field = window.__screenmateScan.scanFields()[0];
      const write = await window.__screenmateAct.applyWrite(field, 'Obsolete degree');
      return {options: field.options, ok: write.ok, selected: document.querySelector('input:checked')?.value || null};
    });
    assert.deepEqual(result, {options: ['High school'], ok: false, selected: null});
  });

  await t.test('disabled and hidden ARIA radios receive no interaction or success verification', async () => {
    for (const unavailable of ['aria-disabled="true"', 'hidden', 'aria-hidden="true"']) {
      const result = await fixture(`<div role="radiogroup" aria-label="Highest degree">
        <div id="unavailable" role="radio" aria-checked="false" ${unavailable}>Bachelor's degree</div>
        <div role="radio" aria-checked="false">High school</div>
      </div>`, async () => {
        const field = window.__screenmateScan.scanFields()[0];
        const el = document.getElementById('unavailable');
        let interactions = 0;
        for (const event of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
          el.addEventListener(event, () => interactions++);
        }
        const write = await window.__screenmateAct.applyWrite(field, "Bachelor's degree", {automatic: true});
        el.setAttribute('aria-checked', 'true');
        return {options: field.options, ok: write.ok, interactions, verified: window.__screenmateAct.verifyWrite(field, "Bachelor's degree").ok};
      });
      assert.deepEqual(result, {options: ['High school'], ok: false, interactions: 0, verified: false}, unavailable);
    }
  });

  await t.test('a visible ARIA radio still receives a click and verifies', async () => {
    const result = await fixture(`<div role="radiogroup" aria-label="Highest degree">
      <div aria-disabled="true" role="radio" aria-checked="false">Bachelor's degree</div>
      <div id="enabled" role="radio" aria-checked="false">Bachelor's degree</div>
    </div>`, async () => {
      const el = document.getElementById('enabled');
      el.addEventListener('click', () => el.setAttribute('aria-checked', 'true'));
      const field = window.__screenmateScan.scanFields()[0];
      const write = await window.__screenmateAct.applyWrite(field, "Bachelor's degree", {automatic: true});
      return {options: field.options, ok: write.ok, checked: el.getAttribute('aria-checked'), verified: window.__screenmateAct.verifyWrite(field, "Bachelor's degree").ok};
    });
    assert.deepEqual(result, {options: ["Bachelor's degree"], ok: true, checked: 'true', verified: true});
  });
});
