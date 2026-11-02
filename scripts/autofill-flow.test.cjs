const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

async function runFlow(scenario = 'dependent') {
  const profile = { name: 'Morgan Example', firstName: 'Morgan', email: 'morgan@example.test', country: 'USA', state: 'GA', degree: 'BFA Game Design', phone: '+1 202-555-0123' };
  const element = (type = 'text') => ({ tagName: type === 'select' ? 'SELECT' : 'INPUT', type, isConnected: true,
    getAttribute: () => null, validity: { valid: true }, willValidate: true,
    checkValidity() { throw new Error('Validation must not dispatch native invalid events'); } });
  const field = (id, label, type = 'text', options) => ({ id, label, type, options, required: true, value: '', el: element(type) });
  const fields = [field('name', 'Full name'), field('first', 'First name'), field('email', 'Email'), field('country', 'Country', 'select', ['Canada', 'United States']), field('degree', 'Highest degree', 'select', ["Bachelor's degree", "Master's degree"]), field('phone', 'Phone number')];
  if (scenario !== 'dependent') {
    fields.splice(0, fields.length,
      { ...field('name', 'Full name'), value: profile.name },
      { ...field('email', 'Email'), value: profile.email },
    );
    if (scenario === 'missing-options') fields.push(field('office', 'Office preference', 'select', []));
    if (scenario === 'ai-dependent') fields.push(field('notes', 'Application notes', 'textarea'));
    if (scenario === 'invalid-email') Object.assign(fields[1], { type: 'email', value: 'not-an-email' });
    if (scenario === 'invalid-url') fields.push({ ...field('website', 'Portfolio website', 'url'), value: 'not-a-url' });
    if (scenario === 'native-invalid') {
      fields[0].el.validity.valid = false;
      fields[0].el.validationMessage = 'Use at most 8 characters.';
    }
    if (scenario === 'aria-invalid') fields[0].el.getAttribute = name => name === 'aria-invalid' ? 'true' : null;
    if (scenario === 'optional-empty') {
      const optional = { ...field('resume', 'Additional document', 'file'), required: false };
      optional.el.validity.valid = false;
      fields.push(optional);
    }
    if (scenario === 'unverified' || scenario === 'became-required') fields[0].value = '';
    if (scenario === 'became-required') fields.push({ ...field('office', 'Office preference', 'select', []), required: false });
  }
  let handlers, rendered, modelCalls = 0, classifyCalls = 0, advanceCalls = 0;
  const scan = {
    scanFields: () => fields.map(item => ({ ...item })),
    pageSignature: () => fields.map(item => item.id + ':' + item.required + ':' + (item.options || []).join('|')).join(','),
    pageContext: () => ({ jobTitle: 'Engineer', company: 'Fixture', url: 'https://fixture.test/apply' }),
    currentValue: el => fields.find(item => item.el === el)?.value || '',
  };
  const act = {
    canAutomate: () => true, isEditing: () => false, onInteraction() {}, highlight() {}, keepField() {},
    readOptions: async item => item.options || [],
    applyWrite: async (item, value) => {
      const live = fields.find(candidate => candidate.id === item.id);
      if (value && live.type === 'select' && !live.options.includes(value)) return { ok: false };
      live.value = value;
      if (item.id === 'name' && scenario === 'became-required') fields.find(item => item.id === 'office').required = true;
      if (item.id === 'country' && !fields.some(item => item.id === 'state')) fields.push(field('state', 'State', 'select', ['Florida', 'Georgia']));
      if (item.id === 'notes' && scenario === 'ai-dependent' && !fields.some(item => item.id === 'visa')) {
        fields.push(field('visa', 'Will you require sponsorship?', 'select', ['Yes', 'No']));
      }
      return { ok: true };
    },
    verifyWrite: (item, expected) => ({ ok: scenario !== 'unverified' && scan.currentValue(item.el) === expected, actual: scan.currentValue(item.el), checks: [{ ok: scenario !== 'unverified', label: 'Committed' }] }),
  };
  const win = {
    __screenmateScan: scan, __screenmateAct: act,
    __screenmateNav: {
      findAdvanceControl: () => ['invalid-email', 'invalid-url', 'native-invalid', 'aria-invalid', 'unverified', 'navigation-failed'].includes(scenario) ? { text: 'Continue' } : null,
      findSubmitControl: () => null,
      advance: async () => { advanceCalls++; return { ok: false, reason: 'The employer form refused to continue.' }; },
    },
    __screenmatePanel: class { constructor(callbacks) { handlers = callbacks; } render(state) { rendered = state; } toggle() {} },
    addEventListener() {}, postMessage() {},
  };
  win.top = win;
  const context = {
    window: win, location: { href: 'https://fixture.test/apply', pathname: '/apply' },
    document: { title: 'Application', documentElement: {}, querySelector: () => null },
    chrome: {
      storage: { local: { get: (_, callback) => callback({ preferences: {} }) } },
      runtime: { onMessage: { addListener() {} }, sendMessage(message, reply) {
        if (message.type === 'screenmate:getProfile') return reply({ profile, profileConfigured: true });
        if (message.route === 'classify') {
          classifyCalls++;
          return reply({ ok: true, data: { fields: message.body.fields.map(item => ({
            ...item, level: item.id === 'visa' ? 'sensitive' : 'safe', sensitive: item.id === 'visa',
            topic: item.id === 'visa' ? 'sponsorship' : null,
          })) } });
        }
        if (scenario === 'ai-dependent' && message.route === 'agent') {
          modelCalls++;
          if (message.body.phase === 'plan') return reply({ ok: true, data: {
            goal: 'Complete this application', observation: 'Application notes need an answer.',
            researchNeeded: false, researchRationale: 'No external research required.', steps: [],
          } });
          return reply({ ok: true, data: {
            decisionSummary: 'Prepare the application notes.',
            actions: [{ tool: 'fillField', args: { fieldId: 'notes', value: 'A short application answer.' } }],
          } });
        }
        modelCalls++; reply({ ok: false, error: 'The factual autofill must not need AI here' });
      } },
    },
    MutationObserver: class { observe() {} },
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, Math.max(1, ms / 100)); timer.unref(); return timer; }, clearTimeout,
  };
  vm.createContext(context);
  for (const file of ['prefs.js', 'main.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension/content', file), 'utf8'), context);
  await win.__screenmateMount();
  handlers.onRun();
  const deadline = Date.now() + 4000;
  while (!['reviewing', 'error', 'complete'].includes(rendered?.status) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  return { fields, get rendered() { return rendered; }, modelCalls, classifyCalls, advanceCalls, handlers };
}

test('real orchestrator fills known facts, rescans a dependent dropdown and needs no model call', async () => {
  const { fields, rendered, modelCalls, classifyCalls } = await runFlow();
  assert.equal(rendered?.status, 'reviewing');
  assert.equal(fields.find(item => item.id === 'country').value, 'United States');
  assert.equal(fields.find(item => item.id === 'state').value, 'Georgia');
  assert.equal(fields.find(item => item.id === 'degree').value, "Bachelor's degree");
  assert.ok(fields.every(item => item.value));
  assert.ok(classifyCalls >= 2, 'dependent questions must be reclassified');
  assert.equal(modelCalls, 0);
  assert.equal(rendered.stats.verifiedActions, fields.length);
});

test('required dropdown without choices stays awaiting input without a model call', async () => {
  const { fields, rendered, modelCalls } = await runFlow('missing-options');
  assert.equal(rendered?.status, 'reviewing');
  assert.equal(fields.find(item => item.id === 'office').value, '');
  assert.equal(rendered.report.blockers.length, 1);
  assert.equal(rendered.report.blockers[0].fieldId, 'office');
  assert.match(rendered.banner, /required fields still need your input/i);
  assert.equal(rendered.changes.length, 0);
  assert.equal(modelCalls, 0);
});

test('an already completed application finishes without changes or a model call', async () => {
  const { rendered, modelCalls } = await runFlow('already-complete');
  assert.equal(rendered?.status, 'complete');
  assert.equal(rendered.report.blockers.length, 0);
  assert.equal(rendered.changes.length, 0);
  assert.equal(rendered.stats.verifiedActions, 0);
  assert.equal(modelCalls, 0);
});

test('a required question revealed by the final AI action is classified before completion', async () => {
  const { fields, rendered, modelCalls, classifyCalls } = await runFlow('ai-dependent');
  assert.equal(rendered?.status, 'reviewing');
  assert.equal(fields.find(item => item.id === 'notes').value, 'A short application answer.');
  assert.equal(fields.find(item => item.id === 'visa').value, '');
  assert.equal(rendered.report.blockers.length, 1);
  assert.equal(rendered.report.blockers[0].fieldId, 'visa');
  assert.ok(classifyCalls >= 3, 'mount, initial run, and newly revealed question are classified');
  assert.equal(modelCalls, 2, 'the new sensitive question needs no additional model call');
});

test('invalid formats and site validation errors block navigation and completion without dispatching invalid events', async () => {
  for (const scenario of ['invalid-email', 'invalid-url', 'native-invalid', 'aria-invalid']) {
    const flow = await runFlow(scenario);
    assert.equal(flow.rendered.status, 'reviewing', scenario);
    assert.equal(flow.advanceCalls, 0, scenario);
    assert.ok(flow.rendered.report.blockers.length, scenario);
    assert.match(flow.rendered.report.blockers[0].message, /Email|Portfolio website|Full name/);
    flow.handlers.onAcceptAll();
    assert.equal(flow.rendered.status, 'reviewing', `${scenario} cannot be accepted as complete`);
    assert.match(flow.rendered.banner, /needs your attention/);
  }
});

test('unconfirmed writes block advancement even when the field is nonempty', async () => {
  const flow = await runFlow('unverified');
  assert.equal(flow.rendered.status, 'reviewing');
  assert.equal(flow.advanceCalls, 0);
  assert.ok(flow.fields.every(item => item.value));
  assert.match(flow.rendered.report.blockers[0].message, /Full name could not be verified/);
});

test('an optional empty upload is not a blocker', async () => {
  const flow = await runFlow('optional-empty');
  assert.equal(flow.rendered.status, 'complete');
  assert.equal(flow.rendered.report.blockers.length, 0);
});

test('failed page advancement stays in review with the employer failure reason', async () => {
  const flow = await runFlow('navigation-failed');
  assert.equal(flow.advanceCalls, 1);
  assert.equal(flow.rendered.status, 'reviewing');
  assert.match(flow.rendered.report.blockers[0].message, /Could not continue from step 1.*employer form refused/);
  flow.handlers.onAcceptAll();
  assert.equal(flow.rendered.status, 'reviewing');
});

test('reverting required fields does not report the application complete', async () => {
  const flow = await runFlow();
  flow.handlers.onRevertAll();
  const deadline = Date.now() + 1000;
  while (flow.rendered.changes.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(flow.rendered.status, 'reviewing');
  assert.equal(flow.rendered.changes.length, 0);
  assert.ok(flow.rendered.report.blockers.length);
});

test('an existing field becoming required is reclassified before completion', async () => {
  const flow = await runFlow('became-required');
  assert.equal(flow.rendered.status, 'reviewing');
  assert.ok(flow.classifyCalls >= 3);
  assert.equal(flow.rendered.report.blockers[0].fieldId, 'office');
});

test('scanner detects required radio groups and fingerprints required-only changes', () => {
  const nodes = [];
  const form = {};
  const doc = {
    querySelector: () => null,
    getElementById: () => null,
    querySelectorAll: selector => selector === '*' ? [] : selector === 'input[type=radio]' ? nodes.filter(node => node.type === 'radio') : nodes,
  };
  const control = (id, label, type = 'text') => ({
    id, type, tagName: 'INPUT', name: type === 'radio' ? 'authorization' : id, form,
    required: false, checked: false, value: '', parentElement: null, ownerDocument: doc,
    getAttribute: name => name === 'aria-label' ? label : null,
    getRootNode: () => doc, closest: () => null,
    getBoundingClientRect: () => ({ width: 100, height: 30 }),
  });
  nodes.push(control('office', 'Office preference'), control('yes', 'Work authorization', 'radio'), control('no', 'Work authorization', 'radio'));
  nodes[2].required = true;
  const context = { document: doc, location: { href: 'https://fixture.test/apply' },
    window: { getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }) } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../extension/content/scan.js'), 'utf8'), context);
  const scan = context.window.__screenmateScan;
  const fields = scan.scanFields();
  assert.equal(fields.length, 2);
  assert.equal(fields.find(field => field.id === 'yes').required, true, 'any required radio makes the group required');
  const before = scan.pageSignature();
  nodes[0].required = true;
  assert.notEqual(scan.pageSignature(), before, 'required attribute changes must trigger a new observation');
});

test('styled upload inputs remain manual file tasks only when their upload UI is visible', () => {
  const inputs = [], labels = [];
  const doc = {
    getElementById: id => [...inputs, ...labels].find(node => node.id === id) || null,
    querySelector: selector => selector.startsWith('label[for=') ? labels.find(label => selector === `label[for="${label.htmlFor}"]`) || null : null,
    querySelectorAll: selector => selector === '*' ? [] : selector === 'input[type=radio]' ? [] : inputs,
  };
  function node(tagName, textContent = '') {
    return {
      tagName, textContent, parentElement: null, ownerDocument: doc, children: [], attrs: {},
      style: { display: 'block', visibility: 'visible', opacity: '1' },
      getAttribute(name) { return this.attrs[name] ?? null; },
      getRootNode: () => doc,
      getBoundingClientRect() { return { width: this.style.display === 'none' ? 0 : 120, height: 30 }; },
      matches(selector) { return selector === ':disabled' && Boolean(this.disabled); },
      contains(child) { return this.children.includes(child); },
      closest(selector) {
        for (let current = this; current; current = current.parentElement) {
          if ((selector.includes('[hidden]') && current.hidden) ||
            (selector.includes('[inert]') && current.inert) ||
            (selector.includes('[aria-hidden="true"]') && current.attrs['aria-hidden'] === 'true') ||
            (selector.includes('[aria-disabled="true"]') && current.attrs['aria-disabled'] === 'true') ||
            (selector === 'label' && current.tagName === 'LABEL') ||
            (selector.includes('[class*=field]') && current.isField)) return current;
        }
        return null;
      },
      querySelector: () => null,
      querySelectorAll(selector) {
        if (selector.startsWith('input:not')) return this.children.filter(child => child.tagName === 'INPUT');
        if (selector.includes('button')) return this.children.filter(child => ['BUTTON', 'LABEL'].includes(child.tagName));
        return this.children.filter(child => child.tagName === 'LABEL');
      },
      cloneNode() { return { textContent: this.textContent, querySelectorAll: () => [] }; },
    };
  }
  function upload(id, labelText, { hiddenSection = false, disabled = false, inert = false, associated = true, group = false } = {}) {
    const section = node('DIV'); section.hidden = hiddenSection;
    const input = Object.assign(node('INPUT'), { id, type: 'file', name: id, hidden: true, required: true, disabled, inert, files: [], value: 'C:\\fakepath\\private-resume.pdf' });
    input.style.display = 'none'; input.parentElement = section;
    const label = node('LABEL', labelText); label.htmlFor = associated ? id : '';
    input.labels = associated ? [label] : [];
    if (group) {
      section.isField = true; section.textContent = labelText + ' Attach file';
      const button = node('BUTTON', 'Attach file'); button.parentElement = section;
      label.parentElement = section;
      section.children = [input, label, button];
    }
    inputs.push(input); labels.push(label);
    return input;
  }
  const resume = upload('resume', 'Resume/CV');
  upload('disabled-upload', 'Disabled upload', { disabled: true });
  upload('inert-upload', 'Inert upload', { inert: true });
  upload('hidden-section-upload', 'Hidden section upload', { hiddenSection: true });
  upload('unrelated-upload', 'Unrelated upload', { associated: false });
  upload('supporting-document', 'Supporting document', { associated: false, group: true });
  const context = { document: doc, location: { href: 'https://fixture.test/apply' }, CSS: { escape: value => value },
    window: { CSS: { escape: value => value }, getComputedStyle: element => element.style } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../extension/content/scan.js'), 'utf8'), context);
  const scan = context.window.__screenmateScan;
  const fields = scan.scanFields();
  assert.deepEqual(Array.from(fields, field => field.id), ['resume', 'supporting-document']);
  assert.equal(fields[0].type, 'file');
  assert.equal(fields[0].label, 'Resume/CV');
  assert.equal(fields[0].required, true);
  assert.equal(fields[0].value, '', 'the native file path must never be read as an answer');
  resume.files = [{ name: 'private-resume.pdf' }];
  assert.equal(scan.scanFields()[0].value, '1 file selected');
});
