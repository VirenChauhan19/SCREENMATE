const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const cache = new Map();

function loadTs(relative) {
  const file = path.resolve(root, relative);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const localRequire = name => {
    if (name.startsWith('.')) return loadTs(path.resolve(path.dirname(file), name + '.ts'));
    return require(name);
  };
  new Function('require', 'module', 'exports', source)(localRequire, module, module.exports);
  return module.exports;
}

const { isNarrativeField, narrativeNeedsExperience } = loadTs('src/lib/answers.ts');
const { isGroundedValue } = loadTs('src/lib/grounding.ts');
const { levelFor } = loadTs('src/lib/policy.ts');
const { executeAction } = loadTs('src/lib/tools.ts');
const { answerLimits, answerFits, answerLimitText } = loadTs('src/lib/answer-constraints.ts');
const profile = { name: 'Morgan Example', addressLine1: '10 Sample Street', experience: 'Maintained a React dashboard.', skills: ['React', 'TypeScript'] };
const draft = 'I built a React dashboard and want to apply that experience to your product.';

function runWrite(label, type, value, extra = {}) {
  const level = levelFor('question-1', label, type);
  const field = { id: 'question-1', label, type, level, sensitive: level === 'sensitive', section: 'role', required: true, value: null, ...extra };
  const state = { roleId: 'fixture', company: 'Example', jobTitle: 'Engineer', jobDescription: '', fields: [field], completedFields: 0, totalFields: 1, validationErrors: [] };
  return executeAction(state, { tool: 'fillField', args: { fieldId: field.id, value } }, profile);
}

test('written questions are recognized in both single-line and multiline controls', () => {
  for (const label of [
    'Why do you want this role?', 'Why Acme?', 'What interests you about this position?',
    'Tell us about yourself', 'Describe a project you built', 'Share an example of collaboration',
    'How do your skills relate to this job?', 'What can you bring to the team?',
    'Cover letter', 'Professional summary', 'Additional information', 'Anything else we should know?', 'Reason for leaving',
  ]) {
    for (const type of ['text', 'textarea']) {
      assert.equal(isNarrativeField(type, label), true, `${type}: ${label}`);
      assert.equal(levelFor('custom-question', label, type), 'review', label);
      assert.equal(isGroundedValue(type, draft, profile, label), true, label);
    }
  }
});

test('factual textareas remain copy-only instead of gaining generation permission', () => {
  for (const label of ['Employer name', 'Current employer name', 'Name of your previous employer', 'Address', 'Mailing address', 'Full name', 'Dates', 'School', 'Degree', 'Work history', 'Skills', 'Please provide email address']) {
    assert.equal(isNarrativeField('textarea', label), false, label);
    assert.equal(isGroundedValue('textarea', 'An invented personal fact', profile, label), false, label);
    assert.equal(levelFor('custom-question', label, 'textarea'), 'safe', label);
  }
  assert.equal(isGroundedValue('textarea', profile.addressLine1, profile, 'Address'), true);
  assert.equal(runWrite('Address', 'textarea', profile.addressLine1).ok, true);
  assert.equal(runWrite('Employer name', 'textarea', 'Invented Corp').ok, false);
});

test('motivation and background-match wording variations remain automatic written questions', () => {
  for (const label of [
    'What attracted you to this role?', 'What excites you about joining our team?',
    'How does your background match this opportunity?', 'What draws you to our mission?',
    'What drew you to apply?', 'What attracts you to this position?',
    'What has drawn you to our company?', 'What is attracting you to this role?',
    'What is exciting about this opportunity?', 'Explain how your experience matches this role.',
  ]) {
    for (const type of ['text', 'textarea']) {
      assert.equal(isNarrativeField(type, label), true, label);
      assert.equal(levelFor('custom-question', label, type), 'review', label);
      assert.equal(runWrite(label, type, draft).ok, true, label);
    }
  }
  assert.equal(isNarrativeField('text', 'Match ID'), false);
  assert.equal(isNarrativeField('text', 'Employer name'), false);
  assert.equal(isNarrativeField('select', 'What attracted you to this role?'), false);
  assert.equal(levelFor('custom-question', 'What excites you about relocation?', 'text'), 'sensitive');
  assert.equal(runWrite('What excites you about relocation?', 'text', draft).ok, false);
});

test('unknown labels and nontext controls cannot request drafted prose', () => {
  for (const type of ['email', 'url', 'select', 'file', 'tags', 'date']) {
    assert.equal(isNarrativeField(type, 'Why this company?'), false, type);
    assert.equal(isGroundedValue(type, draft, profile, 'Why this company?'), false, type);
  }
  assert.equal(isNarrativeField('textarea', ''), false);
  assert.equal(isNarrativeField('textarea', 'Question 481'), false);
  assert.equal(isGroundedValue('textarea', draft, profile), false);
  assert.equal(isGroundedValue('text', '   ', profile, 'Why this role?'), false);
});

test('sensitive personal decisions still override written-answer recognition', () => {
  for (const label of ['Explain your work authorization', 'Describe your salary expectations', 'Why are you willing to relocate?', 'Tell us about your disability']) {
    assert.equal(levelFor('custom-question', label, 'textarea'), 'sensitive', label);
    const result = runWrite(label, 'textarea', draft);
    assert.equal(result.ok, false, label);
    assert.equal(result.approvalRequest.fieldId, 'question-1', label);
  }
});

test('past-event questions require actual history while motivation and self-introductions do not', () => {
  for (const label of ['Describe a project you built', 'Tell us about a time you overcame a challenge', 'What is your proudest accomplishment?', 'Describe your experience with React', 'Share an example of leadership', 'Describe a failure', 'How did you handle a conflict?', 'Why did you leave your last job?', 'Why did you leave your previous role?', 'Reason for leaving', 'reasonsforleaving']) {
    assert.equal(narrativeNeedsExperience(label), true, label);
  }
  for (const label of ['Why this company?', 'Tell us about yourself', 'What interests you about this position?', 'How would you approach a difficult project?', 'How do your skills relate to this job?']) {
    assert.equal(narrativeNeedsExperience(label), false, label);
  }
});

test('one-line drafted answers get review and regeneration just like written textareas', () => {
  const result = runWrite('Why this role?', 'text', draft);
  assert.equal(result.ok, true);
  assert.equal(result.change.regenerable, true);
  assert.equal(result.change.level, 'review');
  assert.equal(result.change.confidence, 'medium');
  assert.equal(result.state.fields[0].value, draft);
  assert.equal(runWrite('Address', 'textarea', profile.addressLine1).change.regenerable, false);
});

test('the tool refuses oversized drafts without silently cutting the answer', () => {
  const rejected = runWrite('Why this role?', 'text', draft, { maxLength: 25 });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.state.fields[0].value, null);
  assert.match(rejected.detail, /25 characters/);
  assert.equal(runWrite('Why this role?', 'text', draft, { maxLength: draft.length }).ok, true);
});

test('minimum character requirements reject short and whitespace-padded answers', () => {
  for (const instructions of ['At least 50 characters', 'Minimum: 50 characters', '50 characters minimum', 'Character minimum: 50']) {
    const field = { label: 'Why this company?', instructions };
    assert.equal(answerLimits(field).minChars, 50, instructions);
    assert.equal(answerFits(field, 'Too short.'), false, instructions);
    assert.equal(answerFits(field, 'Too short.' + ' '.repeat(50)), false, instructions);
    assert.equal(answerFits(field, 'a'.repeat(50)), true, instructions);
    assert.match(answerLimitText(field), /at least 50 characters/);
  }
});

test('word and character ranges enforce both endpoints including en dashes', () => {
  for (const separator of ['-', '–', '—', ' to ']) {
    const words = { label: 'Describe a project', instructions: `10${separator}20 words` };
    const limits = answerLimits(words);
    assert.equal(limits.minWords, 10); assert.equal(limits.maxWords, 20);
    assert.equal(answerFits(words, 'word '.repeat(9).trim()), false);
    assert.equal(answerFits(words, 'word '.repeat(10).trim()), true);
    assert.equal(answerFits(words, 'word '.repeat(21).trim()), false);
    const characters = { label: 'Why this role?', instructions: `50${separator}100 characters` };
    assert.equal(answerLimits(characters).minChars, 50); assert.equal(answerLimits(characters).maxChars, 100);
    assert.equal(answerFits(characters, 'a'.repeat(49)), false);
    assert.equal(answerFits(characters, 'a'.repeat(75)), true);
    assert.equal(answerFits(characters, 'a'.repeat(101)), false);
  }
});

test('unit-first limit wording works and combines with separately stated minimums', () => {
  const field = { label: 'Why this role?', instructions: 'Minimum words: 5. Word limit: 10. Character limit: 100.' };
  const limits = answerLimits(field);
  assert.equal(limits.minWords, 5); assert.equal(limits.maxWords, 10); assert.equal(limits.maxChars, 100);
  assert.equal(answerFits(field, 'Only three words'), false);
  assert.equal(answerFits(field, 'These are exactly five words'), true);
  assert.equal(answerFits(field, 'word '.repeat(11).trim()), false);
  assert.equal(answerFits(field, 'verylongword'.repeat(10)), false);
});

test('native maxlength remains a hard cap and contradictory minimums cannot be bypassed', () => {
  const field = { label: 'Why this role?', maxLength: 40, instructions: 'At least 50 characters. Character limit: 100.' };
  assert.equal(answerLimits(field).maxChars, 40);
  assert.equal(answerLimits(field).minChars, 50);
  assert.equal(answerFits(field, 'a'.repeat(40)), false);
  assert.equal(answerFits(field, 'a'.repeat(50)), false);
  assert.equal(answerLimits({ label: 'Cover letter', instructions: 'Character limit: 50,000', maxLength: 40000 }).maxChars, 12000);
  assert.equal(answerFits({ label: 'Why this company?', maxLength: 0 }, 'a'), false);
});

test('explicit longer limits and minimums have bounded room beyond the default answer size', () => {
  const field = { label: 'Why this role?', instructions: '2,000–3,000 characters' };
  assert.equal(answerLimits(field).minChars, 2000);
  assert.equal(answerLimits(field).maxChars, 3000);
  assert.equal(answerFits(field, 'a'.repeat(2500)), true);
  assert.equal(answerFits(field, 'a'.repeat(1900)), false);
  const impossible = { label: 'Describe a project', instructions: 'At least 20,000 words' };
  assert.equal(answerLimits(impossible).maxChars, 12000);
  assert.equal(answerFits(impossible, 'word '.repeat(1000).trim()), false);
});
