const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// DOM relationship models execute the actual navigation code without opening
// an employer page or sending an application.
function page() {
  const nodes = [], fields = [], controls = [];
  let signature = 'first', beforeClickWait = null;
  class Node {
    constructor(tag, parent, attrs = {}, text = '') {
      this.tagName = tag.toUpperCase(); this.parentElement = parent;
      this.attrs = attrs; this.textContent = text; this.value = '';
      this.id = attrs.id || ''; this.className = attrs.class || '';
      this.isConnected = true; this.disabled = false; this.visible = true;
      this.clicks = 0; nodes.push(this);
    }
    getAttribute(name) { return this.attrs[name] ?? null; }
    matches(selector) {
      return selector.split(',').some(part => {
        const token = part.trim();
        if (!token.startsWith('[')) return this.tagName.toLowerCase() === token;
        const match = token.match(/^\[([^=*\]]+)(\*=|=)([^\]]+)\]$/);
        if (!match) return false;
        const value = String(this.getAttribute(match[1]) || '');
        return match[2] === '=' ? value === match[3] : value.includes(match[3]);
      });
    }
    closest(selector) {
      for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node;
      return null;
    }
    contains(other) {
      for (let node = other; node; node = node.parentElement) if (node === this) return true;
      return false;
    }
    get form() {
      if (this.attrs.form) return nodes.find(node => node.tagName === 'FORM' && node.id === this.attrs.form) || null;
      return this.closest('form');
    }
    scrollIntoView() {}
    click() { this.clicks++; signature = 'second'; }
  }
  const body = new Node('body', null);
  const scan = {
    cleanText: value => String(value || '').replace(/\s+/g, ' ').trim(),
    deepQueryAll: () => controls,
    isVisible: node => node.isConnected && node.visible,
    scanFields: () => fields.map(el => ({ el, type: el.attrs.type || 'text' })),
    pageSignature: () => signature,
  };
  const win = { __screenmateScan: scan };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../extension/content/nav.js'), 'utf8'), {
    window: win,
    setTimeout(fn, ms) {
      return setTimeout(() => { if (ms === 250) beforeClickWait?.(); fn(); }, 1);
    },
  });
  return {
    body, nav: win.__screenmateNav,
    node: (tag, parent = body, attrs = {}) => new Node(tag, parent, attrs),
    field(parent = body, attrs = {}) { const node = new Node('input', parent, attrs); fields.push(node); return node; },
    button(text, parent = body, attrs = {}) { const node = new Node('button', parent, attrs, text); controls.push(node); return node; },
    beforeClick(fn) { beforeClickWait = fn; },
  };
}

test('Next and submit handoff stay inside the application form', () => {
  const p = page(), form = p.node('form'), carousel = p.node('div', p.body, { 'aria-roledescription': 'carousel' });
  p.field(form);
  p.button('Next', carousel, { class: 'primary', 'data-automation-id': 'next' });
  p.button('Next', p.body, { class: 'primary' });
  p.button('Submit Application', p.body);
  const next = p.button('Continue', form), submit = p.button('Submit Application', form);
  assert.equal(p.nav.findAdvanceControl().el, next);
  assert.equal(p.nav.findSubmitControl().el, submit);
});

test('distinct forms with application fields make automatic navigation ambiguous', () => {
  const p = page(), first = p.node('form'), second = p.node('form');
  p.field(first); p.field(second);
  p.button('Next', first); p.button('Next', second);
  p.button('Submit Application', first);
  assert.equal(p.nav.findAdvanceControl(), null);
  assert.equal(p.nav.findSubmitControl(), null);
  assert.match(p.nav.navigationProblem(), /Multiple forms or dialogs/);
});

test('an external button explicitly associated with the application form is supported', async () => {
  const p = page(), form = p.node('form', p.body, { id: 'application' });
  p.field(form);
  const next = p.button('Continue', p.body, { form: 'application' });
  assert.equal(p.nav.findAdvanceControl().el, next);
  assert.equal((await p.nav.advance(p.nav.findAdvanceControl(), { timeout: 100 })).ok, true);
  assert.equal(next.clicks, 1);
});

test('moving the selected Next outside the application during the wait prevents its click', async () => {
  const p = page(), form = p.node('form');
  p.field(form);
  const next = p.button('Next', form), selected = p.nav.findAdvanceControl();
  p.beforeClick(() => { next.parentElement = p.body; });
  assert.equal((await p.nav.advance(selected, { timeout: 100 })).ok, false);
  assert.equal(next.clicks, 0);
});

test('changing the selected control to a submit action never clicks it', async () => {
  const p = page(), form = p.node('form');
  p.field(form);
  const next = p.button('Next', form), selected = p.nav.findAdvanceControl();
  p.beforeClick(() => { next.textContent = 'Submit and continue'; });
  assert.equal((await p.nav.advance(selected, { timeout: 100 })).ok, false);
  assert.equal(next.clicks, 0);
  assert.equal((await p.nav.advance({ el: next })).ok, false);
});

test('form-less Workday-style navigation excludes header, carousel and unrelated popup controls', () => {
  const p = page(), header = p.node('header'), carousel = p.node('div', p.body, { class: 'job-carousel' });
  const cookie = p.node('div', p.body, { role: 'dialog' });
  p.field();
  p.button('Next', header); p.button('Next', carousel); p.button('Continue', cookie);
  p.button('Submit application', cookie);
  const next = p.button('Save and Continue', p.body, { 'data-automation-id': 'bottom-navigation-next-button' });
  assert.equal(p.nav.findAdvanceControl().el, next);
  assert.equal(p.nav.findSubmitControl(), null);
});

test('dialog application controls are scoped and unrelated dialog fields cannot take over', () => {
  const p = page(), dialog = p.node('div', p.body, { role: 'dialog' });
  p.field(dialog);
  p.button('Next');
  const next = p.button('Continue', dialog);
  assert.equal(p.nav.findAdvanceControl().el, next);
  p.field();
  assert.equal(p.nav.findAdvanceControl(), null, 'fields outside a dialog make its ownership ambiguous');
});

test('a dropdown option labelled Next never becomes navigation', () => {
  const p = page(), form = p.node('form'), menu = p.node('div', form, { role: 'listbox' });
  p.field(form);
  p.button('Next', menu);
  assert.equal(p.nav.findAdvanceControl(), null);
});

test('ARIA form containers scope their navigation without a native form tag', () => {
  const p = page(), form = p.node('div', p.body, { role: 'form' });
  p.field(form);
  p.button('Next');
  const next = p.button('Continue', form);
  assert.equal(p.nav.findAdvanceControl().el, next);
});

test('ambiguous forms without a visible application Next do not create a navigation blocker', () => {
  const p = page(), first = p.node('form'), second = p.node('form'), header = p.node('header');
  p.field(first); p.field(second);
  p.button('Submit Application', first);
  p.button('Next', header);
  const hiddenNext = p.button('Continue', second);
  hiddenNext.visible = false;
  assert.equal(p.nav.navigationProblem(), null);
  hiddenNext.visible = true;
  assert.match(p.nav.navigationProblem(), /Choose the correct Next or Continue/);
});

test('an upload-only step keeps its form ownership through the styled file input', async () => {
  const p = page(), form = p.node('form');
  const upload = p.field(form, { type: 'file' });
  upload.visible = false;
  p.button('Next', p.body);
  const next = p.button('Continue', form);
  assert.equal(p.nav.findAdvanceControl().el, next);
  assert.equal((await p.nav.advance(p.nav.findAdvanceControl(), { timeout: 100 })).ok, true);
  assert.equal(next.clicks, 1);
});
