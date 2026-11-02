const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

function loadTs(relative, overrides = {}, cache = new Map()) {
  const file = path.resolve(root, relative);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  new Function('require', 'module', 'exports', source)(name => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (name.startsWith('@/') || name.startsWith('.')) {
      const next = name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : path.resolve(path.dirname(file), name);
      if (fs.existsSync(next + '.ts')) return loadTs(next + '.ts', overrides, cache);
    }
    return require(name);
  }, module, module.exports);
  return module.exports;
}
const auth = { requireKey: () => null, withCors: response => response, preflight: () => new Response(null) };
const field = (id, label, type = 'text', extra = {}) => ({ id, label, type, section: 'role', value: null, required: true, sensitive: false, level: 'safe', ...extra });
const profile = { name: 'Morgan Example', email: 'morgan@example.test', skills: ['React', 'Python'], projects: 'Built a React dashboard with keyboard navigation and a Python CSV validation tool.' };
const body = (fields, extra = {}) => ({ phase: 'act', applicationState: { jobTitle: 'Frontend Engineer', company: 'Cedar Tools', jobDescription: 'Build accessible React dashboards for warehouse teams.', fields, completedFields: 0, totalFields: fields.length }, profile, ...extra });
const req = value => new Request('http://localhost:3000/api/agent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
function agent(respond, review) {
  const calls = [];
  let generationCalls = 0;
  const route = loadTs('src/app/api/agent/route.ts', {
    '@/lib/auth': auth,
    '@/lib/openrouter': { OpenRouterError: class extends Error {}, completeJson: async (messages, schema) => {
      calls.push(messages);
      if (messages[0].content.startsWith('VERIFY PERSONALIZED ANSWERS')) {
        const payload = JSON.parse(messages[1].content);
        return schema.parse(review ? await review(payload) : { reviews: payload.answers.map(answer => ({ fieldId: answer.fieldId, verdict: 'supported' })) });
      }
      return schema.parse(await respond(messages, ++generationCalls));
    } },
  });
  return { calls, post: value => route.POST(req(value)) };
}
const plan = actions => ({ decisionSummary: 'Fill personalized answers from the saved projects and this role.', actions, requiresUserApproval: false });
const write = (fieldId, value) => ({ tool: 'fillField', args: { fieldId, value } });

test('classification recognizes single-line narratives and retains the employer field constraints', async () => {
  const route = loadTs('src/app/api/classify/route.ts', { '@/lib/auth': auth });
  const response = await route.POST(req({ fields: [
    field('why', 'Why are you interested in this role?', 'text', { maxLength: 250, instructions: 'Maximum 40 words.' }),
    field('address', 'Mailing address', 'textarea'),
    field('visa', 'Explain your visa sponsorship requirements', 'textarea'),
  ] }));
  const result = await response.json();
  assert.equal(result.fields[0].narrative, true); assert.equal(result.fields[0].level, 'review');
  assert.equal(result.fields[0].maxLength, 250); assert.equal(result.fields[0].instructions, 'Maximum 40 words.');
  assert.equal(result.fields[1].narrative, false); assert.equal(result.fields[2].narrative, false);
  assert.equal(result.fields[2].sensitive, true);
});

test('personalized answers automatically become writes in both short and long answer boxes', async () => {
  const a = agent(async () => plan([
    write('why', 'My React dashboard work fits Cedar Tools’ focus on accessible warehouse software.'),
    write('project', 'I built a React dashboard with keyboard navigation. That project is relevant to the accessible dashboards this role builds.'),
  ]));
  const response = await a.post(body([field('why', 'Why this role?'), field('project', 'Describe a relevant project', 'textarea')]));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.actions.map(action => action.tool), ['fillField', 'fillField']);
  assert.ok(result.actions.every(action => action.confidence === 'medium'));
  assert.equal(result.requiresUserApproval, false);
  const prompt = a.calls[0].map(message => message.content).join('\n');
  assert.match(prompt, /Cedar Tools/); assert.match(prompt, /keyboard navigation/);
  assert.match(prompt, /accessible React dashboards for warehouse teams/); assert.match(prompt, /narrative=true/);
});

test('missing behavioral evidence requests a real example without calling the model', async () => {
  const a = agent(() => { throw Error('must not invent history'); });
  const response = await a.post(body([field('story', 'Describe a time you led a team', 'textarea')], { profile: { name: 'Morgan', skills: ['React'] } }));
  const result = await response.json();
  assert.equal(a.calls.length, 0);
  assert.equal(result.actions[0].tool, 'requestUserApproval');
  assert.match(result.actions[0].args.reason, /real work or project example/);
});

test('a factual textarea does not authorize invented employers', async () => {
  const a = agent(() => plan([write('employer', 'Made Up Corporation')]));
  const result = await (await a.post(body([field('employer', 'Employer name', 'textarea')]))).json();
  assert.equal(result.actions.length, 0); assert.equal(result.dropped.length, 1);
});

test('oversized generated answers are rewritten to fit rather than truncated', async () => {
  const a = agent((_, call) => call === 1 ? plan([write('why', 'A long answer about the role that is much too long for this small field.')]) : { answers: [{ fieldId: 'why', value: 'My React work fits.' }] });
  const result = await (await a.post(body([field('why', 'Why this role?', 'text', { maxLength: 25, instructions: 'Maximum 5 words' })]))).json();
  assert.equal(a.calls.length, 3);
  assert.equal(result.actions[0].args.value, 'My React work fits.');
  assert.equal(result.actions[0].tool, 'fillField');
});

test('failed length repair preserves valid answers and never writes a partial answer', async () => {
  const a = agent((_, call) => {
    if (call > 1) throw Error('revision unavailable');
    return plan([write('why', 'This answer cannot fit in ten characters.'), write('intro', 'I build accessible React dashboards.')]);
  });
  const result = await (await a.post(body([field('why', 'Why this role?', 'text', { maxLength: 10 }), field('intro', 'Tell us about yourself', 'textarea')]))).json();
  assert.equal(result.actions.find(action => action.args.fieldId === 'why').tool, 'requestUserApproval');
  assert.equal(result.actions.find(action => action.args.fieldId === 'intro').args.value, 'I build accessible React dashboards.');
});

test('a still oversized rewrite gets measured feedback and one bounded retry', async () => {
  const tooLong = 'This rewrite still exceeds the field limit.';
  let retryPrompt;
  const a = agent((messages, call) => {
    if (call === 1) return plan([write('why', 'This initial answer is much too long for the question.')]);
    if (call === 2) return { answers: [{ fieldId: 'why', value: tooLong }] };
    retryPrompt = messages[1].content;
    return { answers: [{ fieldId: 'why', value: 'My React work fits.' }] };
  });
  const result = await (await a.post(body([field('why', 'Why this role?', 'text', { maxLength: 25 })]))).json();
  assert.match(retryPrompt, /attempt 2/);
  assert.ok(retryPrompt.includes('"actualCharacters":' + tooLong.length));
  assert.match(retryPrompt, /"targetCharacters":18/);
  assert.equal(result.actions[0].tool, 'fillField');
  assert.equal(result.actions[0].args.value, 'My React work fits.');
  assert.equal(a.calls.length, 4);
});

test('single-line answers can be regenerated without corrupting links or date ranges', async () => {
  const value = 'My 2021–2023 project work is at https://example.test/project. It uses React.';
  const a = agent(() => ({ value, note: 'Focused on the project.' }));
  const response = await a.post(body([field('why', 'Why this role?', 'text', { value: 'An earlier answer.' })], { phase: 'regenerate', targetFieldId: 'why' }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).value, value);
});

test('regeneration can request a missing specific fact without returning an invented answer', async () => {
  const a = agent(() => ({ needsInput: true, reason: 'What was your actual reason for leaving your previous job?' }));
  const response = await a.post(body([field('why', 'Why did you leave your previous job?', 'text', { value: 'An earlier answer.' })], { phase: 'regenerate', targetFieldId: 'why' }));
  assert.equal(response.status, 422);
  const result = await response.json();
  assert.equal(result.needsInput, true);
  assert.match(result.reason, /actual reason/);
  assert.equal(result.value, undefined);
});

test('unsupported personal claims are corrected before a generated answer can be written', async () => {
  const a = agent(() => plan([write('why', 'I built dashboards for warehouse teams.')]), payload => {
    assert.match(payload.context, /warehouse teams/);
    assert.doesNotMatch(payload.profile.projects, /warehouse/);
    return { reviews: [{ fieldId: 'why', verdict: 'revised', value: 'My React dashboard work would help me contribute to Cedar Tools.' }] };
  });
  const result = await (await a.post(body([field('why', 'Why this role?')]))).json();
  assert.equal(result.actions[0].tool, 'fillField');
  assert.equal(result.actions[0].args.value, 'My React dashboard work would help me contribute to Cedar Tools.');
  assert.equal(result.requiresUserApproval, false);
});

test('question word limits and native character limits are enforced together', () => {
  const { answerFits, answerLimits } = loadTs('src/lib/answer-constraints.ts');
  const target = { label: 'Why this role? (10 words maximum)', maxLength: 30 };
  assert.equal(answerLimits(target).maxChars, 30);
  assert.equal(answerFits(target, 'My React work fits.'), true);
  assert.equal(answerFits(target, 'a '.repeat(11).trim()), false);
  assert.equal(answerFits(target, 'x'.repeat(31)), false);
  assert.equal(answerFits({ label: 'Why this role?' }, 'I built [insert project here].'), false);
  assert.equal(answerFits({ label: 'Describe your project', instructions: 'At least 10 words.' }, 'Too brief.'), false);
});
