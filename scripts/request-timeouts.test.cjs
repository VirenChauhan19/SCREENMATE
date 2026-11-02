const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { z } = require('zod');
const root = path.resolve(__dirname, '..');

function clock() {
  const timers = new Map(), intervals = new Map();
  let nextId = 0;
  return { timers, intervals,
    setTimeout(fn, delay) { const id = ++nextId; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(fn, delay) { const id = ++nextId; intervals.set(id, { fn, delay }); return id; },
    clearInterval(id) { intervals.delete(id); },
  };
}

function provider(fetchImpl, timer) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib/openrouter.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(source, { require, module, exports: module.exports,
    process: { env: { OPENROUTER_API_KEY: 'synthetic-provider-key' } },
    fetch: fetchImpl, AbortController, Error, setTimeout: timer.setTimeout, clearTimeout: timer.clearTimeout,
  });
  return module.exports;
}

async function drainUntil(check) {
  for (let i = 0; i < 20 && !check(); i++) await Promise.resolve();
  assert.ok(check(), 'the asynchronous request must reach the expected stage');
}

test('a stalled provider body remains covered by the 45-second deadline after headers arrive', async () => {
  const timer = clock();
  let reading = false;
  const api = provider(async (_url, options) => ({ ok: true, status: 200,
    text: () => { reading = true; return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted body'), { name: 'AbortError' })));
    }); },
  }), timer);
  const pending = api.completeJson([], z.object({ value: z.string() }));
  const rejected = assert.rejects(pending, error => error instanceof api.OpenRouterError && /timed out/.test(error.message));
  await drainUntil(() => reading);
  assert.equal(timer.timers.size, 1, 'headers must not clear the model deadline');
  const deadline = [...timer.timers.values()][0];
  assert.equal(deadline.delay, 45000);
  deadline.fn();
  await rejected;
  assert.equal(timer.timers.size, 0, 'a failed body read cleans up its timer');
});

test('a complete provider response is parsed once and clears its deadline', async () => {
  const timer = clock();
  let reads = 0;
  const api = provider(async () => ({ ok: true, status: 200,
    text: async () => { reads++; return JSON.stringify({ choices: [{ message: { content: '{"value":"A personalized answer."}' } }] }); },
  }), timer);
  const response = await api.completeJson([], z.object({ value: z.string() }));
  assert.equal(response.value, 'A personalized answer.');
  assert.equal(reads, 1);
  assert.equal(timer.timers.size, 0);
});

function extension(fetchImpl, timer) {
  const context = { URL, AbortController, fetch: fetchImpl,
    setTimeout: timer.setTimeout, clearTimeout: timer.clearTimeout,
    setInterval: timer.setInterval, clearInterval: timer.clearInterval, platformTicks: 0,
    chrome: {
      storage: { local: { get: async () => ({ backendUrl: 'https://screenmate.example', apiKey: 'synthetic-access-key' }) } },
      runtime: { getPlatformInfo(callback) { context.platformTicks++; callback(); },
        getURL: value => value, onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onMessage: { addListener() {} } },
      action: { onClicked: { addListener() {} } },
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'extension/background.js'), 'utf8'), context);
  return context;
}

test('the extension allows answer generation and review longer than ordinary requests', async () => {
  const timer = clock();
  let finishBody;
  const api = extension(async () => ({ ok: true, status: 200,
    text: () => new Promise(resolve => { finishBody = resolve; }),
  }), timer);
  for (const [route, expected] of [['/api/agent', 270000], ['/api/classify', 60000], ['/api/research', 60000]]) {
    finishBody = null;
    const pending = api.callApi(route, { phase: 'act' });
    await drainUntil(() => Boolean(finishBody));
    assert.equal([...timer.timers.values()][0].delay, expected, route);
    assert.equal(timer.intervals.size, route === '/api/agent' ? 1 : 0);
    if (route === '/api/agent') {
      const heartbeat = [...timer.intervals.values()][0];
      assert.equal(heartbeat.delay, 25000);
      heartbeat.fn(); heartbeat.fn();
      assert.equal(api.platformTicks, 2, 'a long request calls a Chrome API before the idle timeout');
    }
    finishBody('{"actions":[]}');
    assert.equal((await pending).ok, true);
    assert.equal(timer.timers.size, 0);
    assert.equal(timer.intervals.size, 0, 'successful responses stop the heartbeat');
  }
});

test('an extension request still reports a timeout if its response body stalls', async () => {
  const timer = clock();
  let reading = false;
  const api = extension(async (_url, options) => ({ ok: true, status: 200,
    text: () => { reading = true; return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted body'), { name: 'AbortError' })));
    }); },
  }), timer);
  const pending = api.callApi('/api/agent', { phase: 'act' });
  await drainUntil(() => reading);
  [...timer.timers.values()][0].fn();
  assert.equal(timer.intervals.size, 0, 'the hard deadline stops the heartbeat immediately');
  const result = await pending;
  assert.equal(result.ok, false);
  assert.match(result.error, /timed out/);
  assert.equal(timer.timers.size, 0);
  assert.equal(timer.intervals.size, 0);
});

test('failed agent requests stop their service-worker heartbeat', async () => {
  for (const failure of ['network', 'http', 'body']) {
    const timer = clock();
    const api = extension(async () => {
      if (failure === 'network') throw new Error('Connection lost');
      return { ok: failure !== 'http', status: failure === 'http' ? 503 : 200, text: async () => {
        if (failure === 'body') throw new Error('Connection lost while reading');
        return '{"error":"Unavailable"}';
      } };
    }, timer);
    assert.equal((await api.callApi('/api/agent', { phase: 'act' })).ok, false);
    assert.equal(timer.timers.size, 0, failure);
    assert.equal(timer.intervals.size, 0, failure);
  }
});
