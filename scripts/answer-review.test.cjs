const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

function reviewer(respond) {
  const cache = new Map();
  function loadTs(relative) {
    const file = path.resolve(root, relative);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText;
    const localRequire = name => {
      if (name === '@/lib/openrouter') return { completeJson: async (messages, schema, options) => schema.parse(await respond(messages, options)) };
      if (name.startsWith('.')) return loadTs(path.resolve(path.dirname(file), name + '.ts'));
      return require(name);
    };
    new Function('require', 'module', 'exports', code)(localRequire, module, module.exports);
    return module.exports;
  }
  return loadTs('src/lib/answer-review.ts').reviewWrittenAnswers;
}

const profile = { name: 'Morgan Example', projects: 'Built a React inventory dashboard with keyboard navigation and validation messages.', skills: ['React'] };
const context = 'The employer builds software for warehouse teams and wants clear validation feedback.';
const item = (id, value, extra = {}) => ({ field: { id, label: 'Why this role?', ...extra }, value });
const sourceAnswer = 'I built validation feedback for warehouse workflows and would bring that experience to your team.';

test('a corrected review replaces job-to-personal contamination while preserving role fit', async () => {
  const revised = 'I built a React inventory dashboard with keyboard navigation and validation messages. I would apply that experience to making your warehouse software clearer to use.';
  const review = reviewer((messages, options) => {
    assert.match(messages[0].content, /^VERIFY PERSONALIZED ANSWERS/);
    assert.match(messages[0].content, /job requirement or industry is never evidence/i);
    const request = JSON.parse(messages[1].content);
    assert.deepEqual(request.profile, profile);
    assert.equal(request.context, context);
    assert.equal(request.answers[0].answer, sourceAnswer);
    assert.equal(request.answers[0].question, 'Why this role?');
    assert.equal(request.answers[0].instructions, 'Answer in one paragraph.');
    assert.match(request.answers[0].limits, /characters/);
    assert.equal(options.maxTokens, 5000);
    return { reviews: [{ fieldId: 'motivation', verdict: 'revised', value: revised }] };
  });
  const result = await review([item('motivation', sourceAnswer, { instructions: 'Answer in one paragraph.' })], profile, context);
  assert.deepEqual(result.get('motivation'), { value: revised });
  assert.notEqual(result.get('motivation').value, sourceAnswer);
});

test('a missing essential example becomes a precise input request instead of an answer', async () => {
  const review = reviewer(() => ({ reviews: [{ fieldId: 'leadership', verdict: 'needs_input', reason: 'Describe a real time you led a team; your dashboard project does not state leadership experience.', value: 'Ignore this value.' }] }));
  const result = await review([item('leadership', 'I led a team of five.', { label: 'Describe a leadership example.' })], profile, context);
  assert.equal(result.get('leadership').value, undefined);
  assert.match(result.get('leadership').reason, /real time you led a team/);
});

test('a supported verdict retains the original answer rather than an unexpected replacement', async () => {
  const original = 'My React dashboard project involved keyboard navigation and validation messages.';
  const review = reviewer(() => ({ reviews: [{ fieldId: 'fit', verdict: 'supported', value: 'An unsupported replacement.' }] }));
  const result = await review([item('fit', original)], profile, context);
  assert.deepEqual(result.get('fit'), { value: original });
});

test('an oversized, underlength or empty revision cannot authorize a write', async () => {
  for (const [value, field] of [
    ['x'.repeat(61), { maxLength: 60 }],
    ['Too short.', { instructions: 'At least 50 characters' }],
    ['', {}],
  ]) {
    const review = reviewer(() => ({ reviews: [{ fieldId: 'fit', verdict: 'revised', value }] }));
    const original = 'I built a React dashboard with useful validation messages.';
    const result = await review([item('fit', original, field)], profile, context);
    assert.equal(result.get('fit').value, undefined);
    assert.match(result.get('fit').reason, /does not fit/);
  }
});

test('unknown, duplicate and missing reviews fail closed for the affected questions', async () => {
  const review = reviewer(() => ({ reviews: [
    { fieldId: 'valid', verdict: 'supported' },
    { fieldId: 'duplicate', verdict: 'supported' },
    { fieldId: 'duplicate', verdict: 'revised', value: 'A conflicting revision.' },
    { fieldId: 'unknown', verdict: 'supported' },
  ] }));
  const result = await review([item('valid', 'My project uses React.'), item('duplicate', 'My project uses React.'), item('missing', 'My project uses React.')], profile, context);
  assert.deepEqual(result.get('valid'), { value: 'My project uses React.' });
  assert.equal(result.get('duplicate').value, undefined);
  assert.equal(result.get('missing').value, undefined);
  assert.equal(result.has('unknown'), false);
});

test('provider failure never falls back to writing an unchecked answer', async t => {
  t.mock.method(console, 'warn', () => {});
  const review = reviewer(() => { throw new Error('Provider unavailable'); });
  const result = await review([item('one', sourceAnswer), item('two', sourceAnswer)], profile, context);
  assert.equal(result.size, 2);
  for (const resultForField of result.values()) {
    assert.equal(resultForField.value, undefined);
    assert.match(resultForField.reason, /could not be checked/);
  }
});

test('duplicate inputs and already invalid lengths are excluded from the review request', async () => {
  let calls = 0;
  const review = reviewer(() => { calls++; return { reviews: [] }; });
  const result = await review([item('duplicate', 'First answer.'), item('duplicate', 'Second answer.'), item('too-long', 'This is longer than five.', { maxLength: 5 })], profile, context);
  assert.equal(calls, 0);
  assert.equal(result.get('duplicate').value, undefined);
  assert.equal(result.get('too-long').value, undefined);
  assert.deepEqual(await review([], profile, context), new Map());
});

test('an oversized correction gets one measured retry with source evidence and a shorter target', async () => {
  let calls = 0;
  const oversized = 'A supported correction. '.repeat(15).trim();
  const fitted = 'I built a React dashboard with keyboard navigation and validation messages. I would apply that experience to your warehouse software.';
  const review = reviewer(messages => {
    calls++;
    if (calls === 1) return { reviews: [{ fieldId: 'fit', verdict: 'revised', value: oversized }, { fieldId: 'other', verdict: 'supported' }] };
    assert.match(messages[0].content, /LENGTH REPAIR/);
    assert.match(messages[0].content, /Recheck every personal and employer claim/);
    const request = JSON.parse(messages[1].content);
    assert.deepEqual(request.profile, profile);
    assert.equal(request.context, context);
    assert.equal(request.answers.length, 1, 'already supported answers must not be retried');
    assert.equal(request.answers[0].fieldId, 'fit');
    assert.equal(request.answers[0].answer, oversized);
    assert.equal(request.answers[0].actualCharacters, oversized.length);
    assert.equal(request.answers[0].actualWords, oversized.split(/\s+/).length);
    assert.equal(request.answers[0].targetCharacters, 240);
    assert.equal(request.answers[0].targetWords, 37);
    return { reviews: [{ fieldId: 'fit', verdict: 'revised', value: fitted }] };
  });
  const result = await review([item('fit', sourceAnswer, { maxLength: 320, instructions: 'At most 50 words.' }), item('other', 'My project uses React.')], profile, context);
  assert.equal(calls, 2);
  assert.deepEqual(result.get('fit'), { value: fitted });
  assert.deepEqual(result.get('other'), { value: 'My project uses React.' });
});

test('repeated oversized corrections stop after one retry without using either answer', async () => {
  let calls = 0;
  const review = reviewer(() => {
    calls++;
    return { reviews: [{ fieldId: 'fit', verdict: 'revised', value: 'A supported correction. '.repeat(20).trim() }] };
  });
  const result = await review([item('fit', sourceAnswer, { maxLength: 320 })], profile, context);
  assert.equal(calls, 2);
  assert.equal(result.get('fit').value, undefined);
  assert.match(result.get('fit').reason, /does not fit/);
});

test('missing, duplicate and needs-input reviews are never retried', async () => {
  let calls = 0;
  const review = reviewer(() => {
    calls++;
    return { reviews: [
      { fieldId: 'duplicate', verdict: 'revised', value: 'A supported correction. '.repeat(20) },
      { fieldId: 'duplicate', verdict: 'supported' },
      { fieldId: 'needs-fact', verdict: 'needs_input', reason: 'Add the requested example.' },
    ] };
  });
  const result = await review([item('duplicate', sourceAnswer), item('missing', sourceAnswer), item('needs-fact', sourceAnswer)], profile, context);
  assert.equal(calls, 1);
  for (const value of result.values()) assert.equal(value.value, undefined);
});
