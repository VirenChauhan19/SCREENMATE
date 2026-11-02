const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Real extension orchestration with deterministic model replies. This verifies
// automatic DOM writes, metadata transport, review, and missing-fact handoff.
async function answerFlow({ missingExperience = false, researchNeeded = false, embedded = false } = {}) {
  const profile = { name: 'Morgan Example', email: 'morgan@example.test', skills: ['TypeScript'],
    projects: missingExperience ? '' : 'Built a TypeScript scheduling tool for a student club.' };
  const field = (id, label, type, maxLength, instructions) => ({ id, label, type, maxLength, instructions,
    required: true, value: '', el: { tagName: type === 'textarea' ? 'TEXTAREA' : 'INPUT', type,
      isConnected: true, getAttribute: () => null, validity: { valid: true } } });
  const fields = [field('name', 'Full name', 'text', 120),
    field('interest', 'Explain how your skills fit this role', 'text', 180, 'Use at most 30 words.'),
    field('example', 'Describe a project you are proud of', 'textarea', 600, 'Describe your own contribution.')];
  const replies = { interest: 'I want to build scheduling tools with TypeScript.',
    example: 'I built a TypeScript scheduling tool for a student club.' };
  const messages = [], writes = [];
  let jobContext = { jobTitle: 'Frontend Engineer', company: 'Fixture',
    jobDescription: 'Build scheduling tools in TypeScript.', url: 'https://fixture.test/apply' };
  let handlers, rendered, parentContext = null;
  const listeners = {};
  const scan = {
    scanFields: () => fields.map(item => ({ ...item })),
    pageSignature: () => 'application-with-written-questions',
    pageContext: () => ({ ...(embedded ? parentContext || { company: 'Board vendor', jobTitle: 'Application', jobDescription: '',
      url: 'https://board.test/embedded' } : jobContext) }),
    setParentContext: value => { parentContext = value; return true; },
    currentValue: el => fields.find(item => item.el === el)?.value || '',
  };
  const act = {
    canAutomate: () => true, isEditing: () => false, onInteraction() {}, highlight() {}, keepField() {},
    readOptions: async () => [],
    applyWrite: async (item, value) => {
      const live = fields.find(candidate => candidate.id === item.id);
      if (live.maxLength && value.length > live.maxLength) return { ok: false, reason: 'too long' };
      live.value = value; writes.push({ id: item.id, value }); return { ok: true };
    },
    verifyWrite: (item, expected) => ({ ok: scan.currentValue(item.el) === expected,
      actual: scan.currentValue(item.el), checks: [{ ok: true, label: 'Committed' }] }),
  };
  const win = {
    __screenmateScan: scan, __screenmateAct: act,
    __screenmateNav: { findAdvanceControl: () => null, findSubmitControl: () => null },
    __screenmatePanel: class { constructor(callbacks) { handlers = callbacks; } render(state) { rendered = state; } toggle() {} },
    addEventListener: (type, fn) => (listeners[type] ||= []).push(fn), postMessage() {},
  };
  win.top = win;
  if (embedded) win.top = { postMessage(message) {
    if (message.__screenmate !== 'screenmate:contextRequest') return;
    setTimeout(() => {
      for (const receive of listeners.message || []) receive({ source: win.top, data: {
        __screenmate: 'screenmate:parentContext', documentId: message.documentId,
        requestId: message.requestId, context: { ...jobContext },
      } });
    }, 1);
  } };
  const context = {
    window: win, location: { href: 'https://fixture.test/apply', pathname: '/apply' },
    document: { title: 'Application', documentElement: {}, querySelector: () => null },
    chrome: {
      storage: { local: { get: (_, callback) => callback({ preferences: {} }) } },
      runtime: { onMessage: { addListener() {} }, sendMessage(message, reply) {
        if (message.type === 'screenmate:getProfile') return reply({ profile, profileConfigured: true });
        messages.push(message);
        if (message.route === 'classify') return reply({ ok: true, data: { fields: message.body.fields.map(item => ({
          ...item, level: item.id === 'name' ? 'safe' : 'review', sensitive: false, narrative: item.id !== 'name',
        })) } });
        if (message.route === 'agent' && message.body.phase === 'plan') return reply({ ok: true, data: {
          goal: 'Answer the application questions', observation: 'Two questions need written answers.',
          researchNeeded, researchRationale: 'Check the role context.', steps: [],
        } });
        if (message.route === 'research') return reply({ ok: true, data: {
          companySummary: `${jobContext.company} builds scheduling tools.`, technicalFocus: ['TypeScript'], relevantContext: [], sources: [],
        } });
        if (message.route === 'agent' && message.body.phase === 'regenerate') return reply({ ok: true,
          data: { value: 'I would bring TypeScript experience from my student club scheduling project.', note: 'Emphasizes a relevant project.' } });
        if (message.route === 'agent' && message.body.phase === 'act') return reply({ ok: true, data: {
          decisionSummary: 'Answer from the saved project details.',
          actions: Object.entries(replies).map(([id, value]) => missingExperience && id === 'example' ?
            { tool: 'requestUserApproval', args: { fieldId: id, reason: 'Add a real project example so I can answer accurately.' } } :
            { tool: 'fillField', args: { fieldId: id, value } }),
        } });
        reply({ ok: false, error: 'Unexpected request in written-answer test' });
      } },
    },
    MutationObserver: class { observe() {} },
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, Math.max(1, ms / 100)); timer.unref(); return timer; }, clearTimeout,
  };
  vm.createContext(context);
  for (const file of ['prefs.js', 'main.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension/content', file), 'utf8'), context);
  await win.__screenmateMount();
  handlers.onRun();
  const deadline = Date.now() + 3000;
  while (!['reviewing', 'waiting', 'complete', 'error'].includes(rendered?.status) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  return { fields, messages, writes, handlers, get rendered() { return rendered; },
    setJobContext: updates => { jobContext = { ...jobContext, ...updates }; } };
}

test('written questions in text inputs and textareas fill automatically with their question limits', async () => {
  const flow = await answerFlow();
  assert.equal(flow.rendered.status, 'reviewing');
  assert.equal(flow.rendered.approval, null);
  assert.equal(flow.fields.find(field => field.id === 'interest').value, 'I want to build scheduling tools with TypeScript.');
  assert.equal(flow.fields.find(field => field.id === 'example').value, 'I built a TypeScript scheduling tool for a student club.');
  assert.equal(flow.rendered.stats.verifiedActions, 3);
  for (const request of flow.messages.filter(message => message.route === 'classify' || message.route === 'agent')) {
    const fields = request.route === 'classify' ? request.body.fields : request.body.applicationState.fields;
    assert.equal(fields.find(field => field.id === 'interest').maxLength, 180);
    assert.equal(fields.find(field => field.id === 'interest').instructions, 'Use at most 30 words.');
    assert.equal(fields.find(field => field.id === 'example').maxLength, 600);
  }
  assert.equal(flow.rendered.changes.find(change => change.fieldId === 'name').regenerable, false);
  assert.equal(flow.rendered.changes.find(change => change.fieldId === 'interest').regenerable, true);
  assert.equal(flow.rendered.changes.find(change => change.fieldId === 'example').regenerable, true);
  flow.handlers.onRegenerate('interest');
  const deadline = Date.now() + 1000;
  while (!flow.fields[1].value.startsWith('I would bring') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.match(flow.fields[1].value, /^I would bring TypeScript/);
  const requestsBefore = flow.messages.length;
  flow.handlers.onRegenerate('name');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(flow.messages.length, requestsBefore, 'copied facts must not be regenerated');
});

test('a missing personal example requests the actual fact instead of fabricating it', async () => {
  const flow = await answerFlow({ missingExperience: true });
  assert.equal(flow.rendered.status, 'waiting');
  assert.equal(flow.fields.find(field => field.id === 'example').value, '');
  assert.equal(flow.rendered.approval.fieldId, 'example');
  assert.match(flow.rendered.approval.reason, /real project example/);
  assert.ok(flow.fields.find(field => field.id === 'interest').value);
});

test('an embedded application waits for current employer context before planning and writing', async () => {
  const flow = await answerFlow({ embedded: true });
  assert.equal(flow.rendered.status, 'reviewing');
  const plans = () => flow.messages.filter(message => message.route === 'agent' && message.body.phase === 'plan');
  assert.equal(plans()[0].body.applicationState.company, 'Fixture');
  assert.equal(plans()[0].body.applicationState.jobTitle, 'Frontend Engineer');
  const before = flow.writes.length;
  flow.setJobContext({ company: 'New employer', jobTitle: 'New role' });
  for (const field of flow.fields.filter(field => field.id !== 'name')) field.value = '';
  flow.handlers.onRun();
  const deadline = Date.now() + 1500;
  while ((flow.writes.length < before + 2 || flow.rendered.status !== 'reviewing') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(plans().at(-1).body.applicationState.company, 'New employer');
  assert.equal(plans().at(-1).body.applicationState.jobTitle, 'New role');
  assert.equal(flow.writes.length, before + 2);
});

test('company research is reused across steps and cleared when the employer or role changes', async () => {
  const flow = await answerFlow({ researchNeeded: true });
  const plans = () => flow.messages.filter(message => message.route === 'agent' && message.body.phase === 'plan');
  const researchCalls = () => flow.messages.filter(message => message.route === 'research').length;
  async function rerun(updates) {
    const before = flow.writes.length;
    flow.setJobContext(updates);
    for (const field of flow.fields.filter(field => field.id !== 'name')) field.value = '';
    flow.handlers.onRun();
    const deadline = Date.now() + 1500;
    while ((flow.writes.length < before + 2 || flow.rendered.status !== 'reviewing') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(flow.rendered.status, 'reviewing');
    assert.equal(flow.writes.length, before + 2);
  }
  assert.equal(researchCalls(), 1);
  await rerun({ url: 'https://fixture.test/apply/step-two' });
  assert.equal(researchCalls(), 1, 'another step for the same role reuses company research');
  assert.ok(plans().at(-1).body.research);
  await rerun({ company: 'Another employer' });
  assert.equal(researchCalls(), 2);
  assert.equal(plans().at(-1).body.research, null, 'old employer research cannot reach the new plan');
  await rerun({ jobTitle: 'Backend Engineer' });
  assert.equal(researchCalls(), 3);
  assert.equal(plans().at(-1).body.research, null, 'old role research cannot reach the new plan');
});

test('scanner reads field-specific visible instructions and refreshes writing constraints', () => {
  const controls = [], help = new Map();
  const doc = {
    querySelector: () => null,
    getElementById: id => help.get(id),
    querySelectorAll: selector => selector === '*' ? [] : controls,
  };
  const node = (attrs = {}, text = '') => ({
    textContent: text, parentElement: null, ownerDocument: doc,
    getAttribute: name => attrs[name] || null,
    getRootNode: () => doc,
    closest: selector => selector.includes('[aria-live]') && attrs['aria-live'] ? {} : null,
    getBoundingClientRect: () => ({ width: 200, height: 30 }),
  });
  help.set('instructions', node({}, 'Use at most 30 words.'));
  help.set('counter', node({ 'aria-live': 'polite' }, '180 characters remaining'));
  help.set('hidden-help', { ...node({}, 'Hidden old question'), hiddenTest: true });
  controls.push({ ...node({ 'aria-label': 'Why do you want this role?', 'aria-describedby': 'instructions counter hidden-help' }),
    id: 'interest', name: 'interest', type: 'text', tagName: 'INPUT', value: '', maxLength: 180 });
  controls.push({ ...node({ 'aria-label': 'Describe a project', 'aria-description': 'Describe your own contribution.' }),
    id: 'project', name: 'project', type: 'textarea', tagName: 'TEXTAREA', value: '', maxLength: -1 });
  const context = { document: doc, location: { href: 'https://fixture.test/apply' },
    window: { getComputedStyle: el => ({ display: el.hiddenTest ? 'none' : 'block', visibility: 'visible', opacity: '1' }) } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../extension/content/scan.js'), 'utf8'), context);
  const scan = context.window.__screenmateScan;
  assert.equal(scan.scanFields()[0].maxLength, 180);
  assert.equal(scan.scanFields()[0].instructions, 'Use at most 30 words.');
  assert.equal(scan.scanFields()[1].maxLength, undefined);
  assert.equal(scan.scanFields()[1].instructions, 'Describe your own contribution.');
  const before = scan.pageSignature();
  controls[0].maxLength = 120;
  assert.notEqual(scan.pageSignature(), before, 'new question limits invalidate pending plans');
  const constrained = scan.pageSignature();
  help.get('counter').textContent = '50 characters remaining';
  assert.equal(scan.pageSignature(), constrained, 'live counters are not question instructions');
});

function postingWindow(metadata, pageUrl = 'https://board.test/jobs/frontend', top) {
  const doc = {
    title: 'Job board', body: { textContent: 'Fallback visible job description.' },
    querySelector: selector => selector === 'meta[property="og:site_name"]' ? { getAttribute: () => 'Job board vendor' } :
      selector === 'h1' || selector === 'h1, h2, [role=heading]' ? { textContent: 'Visible job heading' } : null,
    querySelectorAll: selector => selector === 'script[type="application/ld+json"]' ? [{ textContent: JSON.stringify(metadata) }] : [],
  };
  const win = { document: doc, location: new URL(pageUrl) }; win.top = top || win;
  const context = { document: doc, window: win, location: win.location, URL };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../extension/content/scan.js'), 'utf8'), context);
  return win;
}

function postingContext(metadata, pageUrl) { return postingWindow(metadata, pageUrl).__screenmateScan.pageContext(); }

test('the actual employer and role from job metadata replace a board vendor name', () => {
  const context = postingContext({ '@type': 'JobPosting', title: 'Frontend Engineer',
    hiringOrganization: { name: 'Scheduling &amp; Co' }, description: '<p>Build calendar tools in TypeScript.</p>' });
  assert.equal(context.company, 'Scheduling & Co');
  assert.equal(context.jobTitle, 'Frontend Engineer');
  assert.equal(context.jobDescription, 'Build calendar tools in TypeScript.');
});

test('multiple job postings require a unique page URL match before choosing role context', () => {
  const postings = [
    { '@type': 'JobPosting', url: '/jobs/backend', title: 'Backend Engineer', hiringOrganization: { name: 'Backend Co' } },
    { '@type': 'JobPosting', url: '/jobs/frontend', title: 'Frontend Engineer', hiringOrganization: { name: 'Frontend Co' } },
  ];
  assert.equal(postingContext({ '@graph': postings }).company, 'Frontend Co');
  assert.equal(postingContext({ '@graph': postings }, 'https://board.test/jobs').company, 'Job board vendor');
  assert.equal(postingContext({ '@graph': postings }, 'https://board.test/jobs').jobTitle, 'Visible job heading');
});

test('the active iframe posting takes priority over a generic or different parent posting', () => {
  for (const metadata of [{}, { '@type': 'JobPosting', title: 'Other role', hiringOrganization: { name: 'Other employer' } }]) {
    const parent = postingWindow(metadata, 'https://employer.test/careers');
    const child = postingWindow({ '@type': 'JobPosting', title: 'Actual role', hiringOrganization: { name: 'Actual employer' } },
      'https://board.test/embedded', parent);
    assert.equal(child.__screenmateScan.pageContext().company, 'Actual employer');
    assert.equal(child.__screenmateScan.pageContext().jobTitle, 'Actual role');
  }
});

test('cross-origin parent context is bounded, validated and replaced when the job changes', () => {
  const parent = { get document() { throw new Error('Cross-origin document'); } };
  const child = postingWindow({}, 'https://board.test/embedded', parent), scan = child.__screenmateScan;
  const context = { company: 'Actual employer', jobTitle: 'Frontend Engineer', jobDescription: 'Build scheduling tools.',
    url: 'https://employer.test/careers/frontend', hasStructuredJob: true, ignoredPrivateValue: 'must not be copied' };
  assert.equal(scan.setParentContext(context), true);
  assert.equal(scan.pageContext().company, 'Actual employer');
  assert.equal(scan.pageContext().ignoredPrivateValue, undefined);
  for (const invalid of [{ ...context, jobDescription: 'x'.repeat(4001) }, { ...context, url: 'javascript:alert(1)' },
    { ...context, company: {} }, { ...context, hasStructuredJob: 'true' }]) assert.equal(scan.setParentContext(invalid), false);
  assert.equal(scan.pageContext().company, 'Actual employer');
  scan.setParentContext({ ...context, company: 'New employer', jobTitle: 'Backend Engineer' });
  assert.equal(scan.pageContext().company, 'New employer');
  assert.equal(scan.pageContext().jobTitle, 'Backend Engineer');
  child.location = new URL('https://board.test/embedded/next-job');
  assert.equal(scan.pageContext().company, 'Job board vendor', 'a frame route change must not reuse old parent metadata');
  scan.setParentContext(context); scan.setParentContext(null);
  assert.equal(scan.pageContext().company, 'Job board vendor', 'an expired handoff is explicitly cleared');
});

test('a generic application shell uses a richer visible parent role when structured data is absent', () => {
  const parent = { get document() { throw new Error('Cross-origin document'); } };
  const child = postingWindow({}, 'https://board.test/embedded', parent);
  child.document.querySelector = selector => selector.includes('og:site_name') ? { getAttribute: () => 'Job board vendor' } :
    selector === 'h1' ? { textContent: 'Application' } : null;
  child.__screenmateScan.setParentContext({ company: 'Actual employer', jobTitle: 'Senior Frontend Engineer',
    jobDescription: 'Build scheduling tools with our product team.', url: 'https://employer.test/careers/frontend', hasStructuredJob: false });
  assert.equal(child.__screenmateScan.pageContext().company, 'Actual employer');
});
