const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

function loadTs(relative, overrides = {}) {
  const file = path.resolve(root, relative);
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const localRequire = name => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (name.startsWith('@/')) return loadTs('src/' + name.slice(2) + '.ts', overrides);
    return require(name);
  };
  new Function('require', 'module', 'exports', source)(localRequire, module, module.exports);
  return module.exports;
}

test('old profiles remain readable and detailed career facts survive JSON round trips', () => {
  const { parseApplicant } = loadTs('src/lib/applicant.ts');
  const original = { name: 'Morgan Example', email: 'morgan@example.test', skills: ['TypeScript'] };
  const migrated = parseApplicant(original);
  assert.equal(migrated.professionalSummary, '');
  assert.equal(migrated.experience, '');
  assert.equal(migrated.projects, '');
  const profile = parseApplicant({ ...original, professionalSummary: 'Frontend engineer.', experience: 'A'.repeat(6000), projects: 'Built an accessible scheduling tool.' });
  assert.deepEqual(parseApplicant(JSON.parse(JSON.stringify(profile))), profile);
  assert.throws(() => parseApplicant({ ...profile, experience: 'A'.repeat(6001) }));
  assert.throws(() => parseApplicant({ ...profile, city: 'A'.repeat(501) }));
});

test('trusted website transfer preserves long context while rejecting oversized facts', async () => {
  const stored = { backendUrl: 'https://screenmate.example' };
  let handler;
  const context = { URL, setTimeout, clearTimeout, AbortController,
    fetch: async () => ({ ok: false }),
    chrome: {
      storage: { local: { get: async () => ({ ...stored }), set: async patch => Object.assign(stored, patch) } },
      runtime: { getURL: value => value, onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onMessage: { addListener: fn => { handler = fn; } } },
      action: { onClicked: { addListener() {} } },
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'extension/background.js'), 'utf8'), context);
  const profile = { name: 'Morgan Example', email: 'morgan@example.test', skills: [], experience: 'E'.repeat(6000), projects: 'A real project.' };
  const send = incoming => new Promise(resolve => handler({ type: 'screenmate:website', action: 'saveProfile', profile: incoming }, { url: 'https://screenmate.example/', frameId: 0 }, resolve));
  assert.equal((await send(profile)).ok, true);
  assert.equal(stored.profile.experience, profile.experience);
  assert.equal(stored.profile.projects, profile.projects);
  assert.equal(stored.profile.professionalSummary, '');
  assert.equal((await send({ ...profile, projects: 'P'.repeat(6001) })).ok, false);
  assert.equal(stored.profile.projects, profile.projects, 'a rejected transfer must preserve existing context');
});

test('popup JSON and CV review apply career context to the saved profile', async () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', textContent: '', innerHTML: '', files: [], listeners: {}, addEventListener(event, fn) { this.listeners[event] = fn; } });
    return elements.get(id);
  };
  const stored = { profile: { name: 'Morgan Example', email: 'morgan@example.test', skills: [], projects: 'Previous project.' }, backendUrl: 'https://screenmate.example' };
  const imported = { name: 'Morgan Example', email: 'morgan@example.test', skills: ['React'], experience: 'Detailed responsibility. '.repeat(60).trim(), projects: 'Imported project.' };
  const cvProfile = { experience: 'CV experience evidence. '.repeat(60).trim(), professionalSummary: 'Software engineer.', projects: 'CV project evidence.' };
  const context = {
    document: { getElementById: element }, URL, FormData, AbortSignal,
    setTimeout: () => 0,
    chrome: {
      storage: { local: { get: async () => ({ ...stored }), set: async patch => Object.assign(stored, patch) } },
      runtime: { sendMessage(message, reply) { reply(message.type === 'screenmate:getBackend' ? { base: stored.backendUrl, apiKey: '' } : {}); } },
    },
    fetch: async url => ({ ok: true, json: async () => url.endsWith('/api/parse-cv') ? { profile: cvProfile, chars: 2000, missing: [] } : { service: 'screenmate', configured: { openrouter: true, exa: true }, requiresKey: false } }),
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'extension/popup/popup.js'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(element('projects').value, 'Previous project.');
  const file = new File([JSON.stringify({ version: 1, profile: imported })], 'profile.json');
  await element('profileFile').listeners.change({ target: { files: [file], value: 'profile.json' } });
  assert.equal(element('experience').value, imported.experience);
  assert.equal(stored.profile.projects, 'Previous project.', 'JSON import is reviewed before saving');
  await element('save').listeners.click();
  assert.equal(stored.profile.experience, imported.experience);
  assert.equal(stored.profile.projects, imported.projects);
  element('cvFile').files = [new File(['Example CV text'], 'resume.txt', { type: 'text/plain' })];
  await element('cvGo').listeners.click();
  assert.match(element('cvDiff').innerHTML, /CV experience evidence/);
  assert.equal(stored.profile.experience, imported.experience, 'CV extraction is reviewed before applying');
  await element('cvApply').listeners.click();
  assert.equal(stored.profile.experience, cvProfile.experience);
  assert.equal(stored.profile.professionalSummary, cvProfile.professionalSummary);
  assert.equal(stored.profile.projects, cvProfile.projects);
});

test('CV route returns extracted career evidence and leaves absent sections absent', async () => {
  let source = { name: 'Morgan Example', email: 'morgan@example.test', experience: 'Stated responsibilities. '.repeat(50), projects: 'A stated project.', skills: ['React'] };
  const route = loadTs('src/app/api/parse-cv/route.ts', {
    '@/lib/auth': { requireKey: () => null, withCors: response => response, preflight() {} },
    '@/lib/cv': { kindFromName: () => 'text', extractText: async () => 'CV source material '.repeat(20) },
    '@/lib/openrouter': { OpenRouterError: class extends Error {}, completeJson: async (messages, schema, options) => {
      assert.match(messages[0].content, /professionalSummary/);
      assert.match(messages[0].content, /Never invent seniority/);
      assert.ok(options.maxTokens > 1200);
      return schema.parse(source);
    } },
  });
  const read = async () => {
    const form = new FormData(); form.append('cv', new File(['Example CV'], 'resume.txt'));
    return route.POST(new Request('http://localhost/api/parse-cv', { method: 'POST', body: form }));
  };
  let response = await read(); assert.equal(response.status, 200);
  let data = await response.json();
  assert.equal(data.profile.experience, source.experience.trim());
  assert.equal(data.profile.projects, source.projects);
  assert.equal(data.profile.professionalSummary, undefined);
  source = { name: 'Morgan Example', skills: [] };
  response = await read(); data = await response.json();
  assert.equal(data.profile.experience, undefined);
  assert.equal(data.profile.projects, undefined);
});
