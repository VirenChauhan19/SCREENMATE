const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { unzipSync, strFromU8 } = require('fflate');
const root = path.resolve(__dirname, '..');

// Exercise actual route handlers without a paid provider call or employer form.
function loadTs(relative, overrides = {}, cache = new Map()) {
  const file = path.resolve(root, relative);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const localRequire = (name) => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (name.startsWith('@/') || name.startsWith('.')) {
      const next = name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : path.resolve(path.dirname(file), name);
      if (fs.existsSync(next + '.ts')) return loadTs(next + '.ts', overrides, cache);
    }
    return require(name);
  };
  new Function('require', 'module', 'exports', source)(localRequire, module, module.exports);
  return module.exports;
}

function request(body, headers = {}) {
  return new Request('http://localhost:3000/api/agent', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-screenmate-key': 'regression-only-secret', ...headers },
    body: JSON.stringify(body),
  });
}

test('access control, policy, packaging, and real-site regressions', async (suite) => {
  const originalKey = process.env.SCREENMATE_API_KEY;
  process.env.SCREENMATE_API_KEY = 'regression-only-secret';
  suite.after(() => { if (originalKey === undefined) delete process.env.SCREENMATE_API_KEY; else process.env.SCREENMATE_API_KEY = originalKey; });
  const auth = loadTs('src/lib/auth.ts');

  await suite.test('same-origin headers cannot bypass the access key', () => {
    const denied = auth.requireKey(new Request('https://screenmate.example/api/agent', {
      method: 'POST', headers: { origin: 'https://screenmate.example', host: 'screenmate.example' },
    }));
    assert.equal(denied.status, 401);
    assert.equal(auth.requireKey(request({})), null);
  });

  await suite.test('website session authenticates; forged and cross-origin sessions do not', async () => {
    const session = loadTs('src/app/api/session/route.ts');
    assert.equal(session.POST(request({}, { 'x-screenmate-key': 'wrong' })).status, 401);
    const response = session.POST(request({}));
    const cookie = response.headers.get('set-cookie');
    assert.match(cookie, /httponly/i);
    assert.match(cookie, /samesite=strict/i);
    const sessionCookie = cookie.split(';')[0];
    assert.equal(auth.requireKey(new Request('http://localhost:3000/api/agent', { headers: { cookie: sessionCookie, origin: 'http://localhost:3000' } })), null);
    assert.equal(auth.requireKey(new Request('http://localhost:3000/api/agent', { headers: { cookie: sessionCookie, origin: 'https://employer.example' } })).status, 401);
    assert.equal(auth.hasSession(new Request('http://localhost:3000', { headers: { cookie: sessionCookie + 'tampered' } })), false);
    assert.equal(auth.requireKey(new Request('http://localhost:3000/api/agent', { headers: { cookie: sessionCookie, host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' } })), null);
    assert.match(session.DELETE().headers.get('set-cookie'), /max-age=0/i);
  });

  const field = (id, label, type = 'text', extra = {}) => ({ id, label, type, section: 'personal', value: null, required: true, sensitive: false, level: 'safe', ...extra });
  const payload = (fields, phase = 'act') => ({ phase, profile: { firstName: 'Morgan', country: 'Country 250' }, applicationState: {
    jobTitle: 'Engineer', company: 'Example', jobDescription: 'Build software.', fields,
    completedFields: 0, totalFields: fields.length, validationErrors: [],
  } });
  let calls = 0;
  const agent = loadTs('src/app/api/agent/route.ts', {
    '@/lib/openrouter': {
      OpenRouterError: class extends Error {},
      completeJson: async () => {
        calls++;
        return { decisionSummary: 'Fill profile fields.', requiresUserApproval: false, actions: [
          { tool: 'fillField', args: { fieldId: 'first', value: 'Morgan' } },
          { tool: 'fillField', args: { fieldId: 'existing', value: 'Morgan' } },
          { tool: 'fillField', args: { fieldId: 'secret-topic', value: 'Morgan' } },
          { tool: 'fillField', args: { fieldId: 'client-sensitive', value: 'Morgan' } },
          { tool: 'selectOption', args: { fieldId: 'country', value: 'Country 250' } },
          { tool: 'selectOption', args: { fieldId: 'bad-option', value: 'Morgan' } },
          { tool: 'fillField', args: { fieldId: 'unknown', value: 'Morgan' } },
          { tool: 'fillField', args: { fieldId: 'wrong-tool', value: 'Morgan' } },
        ] };
      },
    },
  });

  await suite.test('server reclassifies sensitive fields and filters invalid writes', async () => {
    const response = await agent.POST(request(payload([
      field('first', 'First name'), field('existing', 'Preferred name', 'text', { value: 'User choice' }),
      field('secret-topic', 'Do you require visa sponsorship?'),
      field('client-sensitive', 'Personal decision', 'text', { level: 'sensitive' }),
      field('country', 'Country', 'select', { options: Array.from({ length: 280 }, (_, i) => `Country ${i}`) }),
      field('bad-option', 'Degree', 'select', { options: ['Bachelor', 'Master'] }),
      field('wrong-tool', 'Degree', 'select', { options: ['Morgan'] }),
    ])));
    assert.equal(response.status, 200);
    const result = await response.json();
    const writes = result.actions.filter(action => ['fillField', 'selectOption'].includes(action.tool));
    assert.deepEqual(writes.map(action => action.args.fieldId), ['first', 'country']);
    assert.deepEqual(result.actions.filter(action => action.tool === 'requestUserApproval').map(action => action.args.fieldId), ['secret-topic', 'client-sensitive']);
  });

  await suite.test('large real forms pass validation and unsafe regeneration never calls AI', async () => {
    const fields = Array.from({ length: 100 }, (_, i) => field(`field-${i}`, `Question ${i}`));
    assert.equal((await agent.POST(request(payload(fields)))).status, 200);
    const before = calls;
    for (const target of [field('target', 'First name'), field('target', 'Work authorization', 'textarea')]) {
      const response = await agent.POST(request({ ...payload([target], 'regenerate'), targetFieldId: 'target' }));
      assert.equal(response.status, 400);
    }
    assert.equal(calls, before);
  });

  await suite.test('extension download contains website configuration without credentials or profiles', async () => {
    const download = loadTs('src/app/api/extension/route.ts');
    const response = await download.GET(new Request('https://screenmate.example/api/extension'));
    assert.equal(response.status, 200);
    const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
    const config = JSON.parse(strFromU8(files['config.json']));
    assert.deepEqual(config, { backendUrl: 'https://screenmate.example' });
    const manifest = JSON.parse(strFromU8(files['manifest.json']));
    assert.ok(manifest.host_permissions.includes('https://screenmate.example/*'));
    for (const content of manifest.content_scripts) for (const file of content.js) assert.ok(files[file], `${file} missing`);
    assert.ok(files['popup/popup.js']);
    assert.equal(Object.keys(files).some(name => name.includes('.env')), false);
    assert.equal(Buffer.from(await new Response(new Uint8Array(files['config.json'])).arrayBuffer()).includes(Buffer.from('regression-only-secret')), false);
  });

  await suite.test('saved declarations cannot reverse an answer on differently worded questions', () => {
    const context = { window: {}, chrome: {} };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'extension/content/prefs.js'), 'utf8'), context);
    const prefs = context.window.__screenmatePrefs;
    const sponsorship = label => ({ label, topic: 'sponsorship', type: 'select', options: ['Yes', 'No'] });
    assert.equal(prefs.resolve(sponsorship('Will you now or in the future require sponsorship?'), { sponsorship: 'No' }).value, 'No');
    assert.equal(prefs.resolve(sponsorship('Can you work without requiring sponsorship?'), { sponsorship: 'No' }), null);
    assert.equal(prefs.resolve({ label: 'Are you a citizen?', topic: 'workAuthorization', type: 'select', options: ['Yes', 'No'] }, { workAuthorization: 'Yes' }), null);
    assert.equal(prefs.resolve({ label: 'Desired salary in EUR per month', topic: 'salary', type: 'text' }, { salary: '120000' }), null);
  });

  await suite.test('input combobox reads its selected sibling after the query is cleared', () => {
    const context = { window: {}, document: {} };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'extension/content/scan.js'), 'utf8'), context);
    const input = { tagName: 'INPUT', type: 'text', value: '', textContent: '', getAttribute: name => name === 'role' ? 'combobox' : null,
      parentElement: { querySelectorAll: () => [input], querySelector: () => ({ textContent: 'United States' }), parentElement: null },
    };
    assert.equal(context.window.__screenmateScan.currentValue(input), 'United States');
    input.parentElement.querySelector = () => null;
    assert.equal(context.window.__screenmateScan.currentValue(input), '');
  });

  await suite.test('fresh extension has no sample profile and website bridge is origin and frame restricted', async () => {
    const stored = { backendUrl: 'https://screenmate.example', apiKey: 'not-exposed' };
    let handler, installed;
    const context = { URL, setTimeout, clearTimeout, AbortController,
      fetch: async () => ({ ok: false }),
      chrome: {
        storage: { local: { get: async () => ({ ...stored }), set: async patch => Object.assign(stored, patch) } },
        runtime: { getURL: name => `chrome-extension://test/${name}`, onInstalled: { addListener: fn => installed = fn }, onStartup: { addListener() {} }, onMessage: { addListener: fn => handler = fn } },
        action: { onClicked: { addListener() {} } },
      },
    };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'extension/background.js'), 'utf8'), context);
    await installed();
    const message = (msg, sender = {}) => new Promise(resolve => handler(msg, sender, resolve));
    assert.equal((await message({ type: 'screenmate:getProfile' })).profileConfigured, false);
    assert.equal(stored.profile.name, '');
    const transfer = { type: 'screenmate:website', action: 'saveProfile', profile: { name: 'Morgan Example', email: 'morgan@example.org', skills: ['JavaScript'] } };
    assert.equal((await message(transfer, { url: 'https://employer.example/apply', frameId: 0 })).ok, false);
    assert.equal((await message(transfer, { url: 'https://screenmate.example', frameId: 1 })).ok, false);
    const accepted = await message(transfer, { url: 'https://screenmate.example', frameId: 0 });
    assert.equal(accepted.ok, true);
    assert.deepEqual(Object.keys(accepted), ['ok']);
    assert.equal((await message({ type: 'screenmate:getProfile' })).profileConfigured, true);
    stored.profile = { name: 'Viren Chauhan', email: 'viren@example.com' }; stored.profileConfirmed = false;
    assert.equal((await message({ type: 'screenmate:getProfile' })).profileConfigured, false);
  });
});
