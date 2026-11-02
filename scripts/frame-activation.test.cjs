const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Run the real orchestrator with WindowProxy/message models. No browser,
// employer form, application submission or network request is involved.
function host(topWindow) {
  const listeners = {}, timers = new Map(), panels = [];
  const contexts = [];
  let nextTimer = 0, runtimeListener;
  const win = {
    frames: [],
    __screenmateScan: { scanFields: () => [], pageSignature: () => 'empty', pageContext: () => ({}),
      contextForMessage: () => ({ company: 'Current employer', jobTitle: 'Current role', jobDescription: 'Current posting',
        url: 'https://employer.test/careers', hasStructuredJob: true }),
      setParentContext: context => { contexts.push(context); return true; } },
    __screenmateAct: { onInteraction() {} },
    __screenmateNav: { findAdvanceControl: () => null },
    __screenmatePrefs: { load: async () => ({}) },
    __screenmatePanel: class {
      constructor() { this.toggles = []; panels.push(this); }
      render() {}
      toggle(value) { this.toggles.push(value); }
    },
    addEventListener: (type, fn) => (listeners[type] ||= []).push(fn),
    postMessage(data) { dispatch({ source: win, data }); },
  };
  win.top = topWindow || win;
  function dispatch(event) { for (const fn of listeners.message || []) fn(event); }
  const context = {
    window: win, document: { querySelector: () => null, documentElement: {}, title: 'Careers' },
    location: { href: 'https://employer.test/careers', pathname: '/careers' },
    chrome: { runtime: {
      onMessage: { addListener: fn => { runtimeListener = fn; } },
      sendMessage(message, reply) {
        if (message.type === 'screenmate:getProfile') queueMicrotask(() => reply({ profile: {} }));
      },
    } },
    MutationObserver: class { observe() {} },
    setTimeout(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../extension/content/main.js'), 'utf8'), context);
  const claim = (source, count, documentId, manual = false) => dispatch({
    source, data: { __screenmate: 'screenmate:claim', count, documentId, manual },
  });
  return {
    win, panels, claim, dispatch, contexts,
    frame(id, count = 5) {
      const frame = { frames: [], messages: [], postMessage(message) {
        frame.messages.push(message);
        if (message.__screenmate === 'screenmate:identifyFrame') claim(frame, count, id, true);
      } };
      return frame;
    },
    open: () => runtimeListener({ type: 'screenmate:open' }),
    flush(ms) {
      for (const [id, timer] of [...timers]) {
        if (timer.ms === ms && timers.delete(id)) timer.fn();
      }
    },
  };
}

test('a replacement iframe can claim the panel and receive a manual Open', () => {
  const h = host(), original = h.frame('original'), replacement = h.frame('replacement');
  h.win.frames = [original];
  h.claim(original, 5, 'original'); h.flush(600);
  assert.equal(original.messages.at(-1).__screenmate, 'screenmate:youWon');
  h.win.frames = [replacement];
  h.claim(replacement, 6, 'replacement'); h.flush(600);
  assert.equal(replacement.messages.at(-1).__screenmate, 'screenmate:youWon');
  h.open();
  assert.equal(replacement.messages.at(-1).__screenmate, 'screenmate:openWinner');
  assert.equal(original.messages.length, 1, 'removed iframe must receive no later commands');
});

test('a new document in the same iframe reacquires ownership without duplicate announcements', () => {
  const h = host(), frame = h.frame('first-document');
  h.win.frames = [frame];
  h.claim(frame, 5, 'first-document'); h.flush(600);
  h.claim(frame, 4, 'second-document');
  assert.equal(frame.messages.length, 2);
  assert.equal(frame.messages[1].__screenmate, 'screenmate:youWon');
  h.claim(frame, 4, 'second-document');
  assert.equal(frame.messages.length, 2);
});

test('manual Open finds a short form after its previous iframe was removed', () => {
  const h = host(), original = h.frame('old'), shortForm = h.frame('new', 1);
  h.win.frames = [original];
  h.claim(original, 5, 'old'); h.flush(600);
  h.win.frames = [shortForm];
  h.open(); h.flush(600); h.flush(800);
  assert.equal(shortForm.messages.at(-1).__screenmate, 'screenmate:openWinner');
  assert.equal(original.messages.length, 1);
  assert.equal(h.panels.length, 0, 'the empty host page must not take the panel');
});

test('detached and unrelated windows cannot win a form election', () => {
  const h = host(), removed = h.frame('removed'), live = h.frame('live');
  h.win.frames = [live];
  h.claim(removed, 100, 'removed');
  h.claim(live, 3, 'live'); h.flush(600);
  assert.equal(removed.messages.length, 0);
  assert.equal(live.messages.at(-1).__screenmate, 'screenmate:youWon');
});

test('overlapping auto-mount and manual Open create one expanded panel', async () => {
  const h = host();
  await Promise.all([h.win.__screenmateMount({ collapsed: true }), h.win.__screenmateMount()]);
  assert.equal(h.panels.length, 1);
  assert.deepEqual(h.panels[0].toggles, [false]);
});

test('parent context is fresh on election, iframe replacement and subsequent requests', () => {
  const h = host(), first = h.frame('first'), replacement = h.frame('replacement');
  h.win.frames = [first]; h.claim(first, 5, 'first'); h.flush(600);
  assert.equal(first.messages.at(-1).context.company, 'Current employer');
  const next = { company: 'Another employer', jobTitle: 'Another role', jobDescription: 'Another posting',
    url: 'https://employer.test/careers/another', hasStructuredJob: true };
  h.win.__screenmateScan.contextForMessage = () => next;
  h.win.frames = [replacement]; h.claim(replacement, 5, 'replacement'); h.flush(600);
  assert.equal(replacement.messages.at(-1).context.company, 'Another employer');
  h.dispatch({ source: first, data: { __screenmate: 'screenmate:contextRequest', documentId: 'first', requestId: 'old' } });
  assert.equal(first.messages.length, 1, 'a detached frame receives no context');
  next.jobTitle = 'Updated role';
  h.dispatch({ source: replacement, data: { __screenmate: 'screenmate:contextRequest', documentId: 'replacement', requestId: 'fresh' } });
  assert.equal(replacement.messages.at(-1).context.jobTitle, 'Updated role');
  assert.equal(replacement.messages.at(-1).requestId, 'fresh');
});

test('a child accepts context only from its top window and for its current document', () => {
  const parent = { messages: [], postMessage(message) { this.messages.push(message); } };
  const h = host(parent);
  h.win.__screenmateScan.scanFields = () => [{ id: 'email', label: 'Email' }];
  h.dispatch({ source: parent, data: { __screenmate: 'screenmate:identifyFrame' } });
  const { documentId } = parent.messages.at(-1);
  const data = { __screenmate: 'screenmate:parentContext', documentId, context: { company: 'Actual employer' } };
  h.dispatch({ source: {}, data });
  h.dispatch({ source: parent, data: { ...data, documentId: 'previous-document' } });
  assert.equal(h.contexts.length, 0);
  h.dispatch({ source: parent, data });
  assert.equal(h.contexts.length, 1);
  assert.equal(h.contexts[0].company, 'Actual employer');
});
