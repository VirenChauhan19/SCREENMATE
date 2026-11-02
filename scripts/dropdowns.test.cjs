const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Event-driven widget models run the real writer, without a browser or network.
function widget({ kind = 'search', labels = ['SCAD', 'SCAD Extension'], ignoreClick = false, popupSearch = false, openOn = 'click', selectOn = 'click' } = {}) {
  const listeners = {};
  const later = (fn, ms) => setTimeout(fn, Math.max(1, ms / 40));
  class Node {
    constructor(tag = 'DIV') { this.tagName = tag; this.attrs = {}; this.textContent = ''; this.isConnected = true; this.visible = true; this.disabled = false; this.readOnly = false; this.classList = { add() {}, remove() {} }; }
    getAttribute(name) { return this.attrs[name] ?? null; }
    contains(node) { return node === this; }
    scrollIntoView() {}
    focus() {}
    blur() {}
    checkValidity() { return true; }
    querySelector() { return null; }
    querySelectorAll() { return []; }
    dispatchEvent(event) { this.onEvent?.(event); return !event.defaultPrevented; }
    click() { this.onClick?.(); }
  }
  class Input extends Node {
    constructor() { super('INPUT'); this._value = ''; this.type = 'text'; }
    get value() { return this._value; }
    set value(value) { this._value = value; }
  }
  class Select extends Input {}
  class Textarea extends Input {}
  const control = kind === 'search' ? new Input() : new Node('BUTTON');
  control.attrs = { role: 'combobox', 'aria-controls': 'menu', 'aria-expanded': 'false' };
  const search = kind === 'search' ? control : popupSearch ? new Input() : null;
  const popup = new Node();
  popup.attrs.role = 'listbox'; popup.visible = false;
  popup.clientHeight = kind === 'virtual' ? 100 : 0;
  popup.scrollHeight = kind === 'virtual' ? labels.length * 20 : 0;
  let top = 0, items = [], selected = '', queryTimer;
  function render(values) {
    items = values.map(label => {
      const option = new Node(); option.textContent = label; option.attrs.role = 'option';
      const select = () => {
        if (ignoreClick) return;
        selected = label; option.attrs['aria-selected'] = 'true';
        if (kind === 'search') control.value = ''; else control.textContent = label;
        control.attrs['aria-expanded'] = 'false'; popup.visible = false;
      };
      option.onClick = () => { if (selectOn === 'click') select(); };
      option.onEvent = event => { if (event.type === selectOn && event.pointerType === 'mouse' && event.button === 0) select(); };
      return option;
    });
  }
  Object.defineProperty(popup, 'scrollTop', { get: () => top, set: value => { top = value; if (kind === 'virtual') render(labels.slice(Math.floor(top / 20), Math.floor(top / 20) + 5)); } });
  popup.querySelectorAll = selector => {
    if (selector.includes('input')) return popupSearch ? [search] : [];
    return items;
  };
  const open = () => {
    control.attrs['aria-expanded'] = control.attrs['aria-expanded'] === 'true' ? 'false' : 'true';
    popup.visible = control.attrs['aria-expanded'] === 'true';
    if (kind === 'virtual') popup.scrollTop = top;
    else if (!search) render(labels);
  };
  control.onClick = () => { if (openOn === 'click') open(); };
  control.onEvent = event => {
    if (event.type === openOn && event.button === 0) { open(); event.preventDefault(); }
    if (event.key === 'Escape') { popup.visible = false; control.attrs['aria-expanded'] = 'false'; }
  };
  popup.onEvent = event => { if (event.key === 'Escape') { popup.visible = false; control.attrs['aria-expanded'] = 'false'; } };
  if (search) {
    const baseHandler = search.onEvent;
    search.onEvent = event => {
      baseHandler?.(event);
      if (event.type === 'input') {
        clearTimeout(queryTimer); selected = ''; items = [];
        const query = search.value;
        queryTimer = later(() => {
          if (query.length >= 3) {
            control.attrs['aria-expanded'] = 'true'; popup.visible = true;
            render(labels.filter(label => label.toLowerCase().includes(query.toLowerCase())));
          }
        }, 650);
      }
    };
  }
  const field = { id: 'school', label: 'School', type: 'select', el: control, options: [] };
  const scan = {
    cleanText: value => String(value || '').replace(/\s+/g, ' ').trim(),
    scanFields: () => [field], pageSignature: () => 'same-form',
    isVisible: node => Boolean(node?.isConnected && node.visible),
    referencedElement: (_, id) => id === 'menu' ? popup : null,
    deepQueryAll: () => popup.visible ? [popup] : [],
    currentValue: node => selected || node.value || node.textContent || '',
  };
  class DomEvent {
    constructor(type, options = {}) { this.type = type; Object.assign(this, options); }
    preventDefault() { this.defaultPrevented = true; }
  }
  const context = {
    window: { __screenmateScan: scan }, location: { href: 'https://fixture.test/application' },
    document: { addEventListener: (type, callback) => { (listeners[type] ||= []).push(callback); } },
    Element: Node, HTMLInputElement: Input, HTMLSelectElement: Select, HTMLTextAreaElement: Textarea,
    Event: DomEvent, KeyboardEvent: DomEvent, MouseEvent: DomEvent, PointerEvent: DomEvent, setTimeout: later,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../extension/content/act.js'), 'utf8'), context);
  return { act: context.window.__screenmateAct, field, control, popup, search, scan, selected: () => selected,
    edit(value) { search.value = value; for (const fn of listeners.input || []) fn({ type: 'input', isTrusted: true, composedPath: () => [control] }); },
    cleanup() { clearTimeout(queryTimer); }, later,
  };
}

test('search discovers delayed options, restores query, and commits exact choice', async t => {
  const w = widget(); t.after(w.cleanup);
  assert.deepEqual(Array.from(await w.act.readOptions(w.field, { query: 'SCAD' })), ['SCAD', 'SCAD Extension']);
  assert.equal(w.control.value, ''); assert.equal(w.selected(), '');
  assert.equal((await w.act.applyWrite(w.field, 'SCAD', { automatic: true })).ok, true);
  assert.equal(w.selected(), 'SCAD'); assert.equal(w.act.verifyWrite(w.field, 'SCAD').ok, true);
});

test('query text is not a selection when the site ignores the click', async t => {
  const w = widget({ ignoreClick: true }); t.after(w.cleanup);
  assert.equal((await w.act.applyWrite(w.field, 'SCAD', { automatic: true })).ok, false);
  assert.equal(w.selected(), ''); assert.equal(w.control.value, '');
  assert.equal(w.act.verifyWrite(w.field, 'SCAD').ok, false);
});

test('virtual menu discovers later windows and reopens from the top to select', async t => {
  const w = widget({ kind: 'virtual', labels: Array.from({ length: 60 }, (_, i) => `Country ${i}`) }); t.after(w.cleanup);
  assert.ok((await w.act.readOptions(w.field)).includes('Country 49'));
  assert.equal((await w.act.applyWrite(w.field, 'Country 21', { automatic: true })).ok, true);
  assert.equal(w.selected(), 'Country 21'); assert.equal(w.act.verifyWrite(w.field, 'Country 21').ok, true);
});

test('button dropdown searches through its associated popup input', async t => {
  const w = widget({ kind: 'button', popupSearch: true }); t.after(w.cleanup);
  assert.ok((await w.act.readOptions(w.field, { query: 'SCAD' })).includes('SCAD'));
  assert.equal(w.search.value, '');
  assert.equal((await w.act.applyWrite(w.field, 'SCAD')).ok, true);
  assert.equal(w.selected(), 'SCAD');
});

test('a user edit cancels discovery without restoring over it', async t => {
  const w = widget(); t.after(w.cleanup);
  const reading = w.act.readOptions(w.field, { query: 'SCAD' });
  w.later(() => w.edit('My own school'), 400);
  assert.equal((await reading).length, 0); assert.equal(w.control.value, 'My own school');
  assert.equal(w.act.canAutomate(w.field), false);
});

test('duplicate or missing choices leave the input unchanged', async t => {
  const w = widget({ labels: ['SCAD', 'SCAD'] }); t.after(w.cleanup);
  assert.equal((await w.act.applyWrite(w.field, 'SCAD')).ok, false); assert.equal(w.control.value, '');
  assert.equal((await w.act.applyWrite(w.field, 'Unknown School')).ok, false); assert.equal(w.control.value, '');
});

test('phone formatting verifies only when every digit is preserved', t => {
  const w = widget(); t.after(w.cleanup);
  w.field.type = 'text'; w.field.label = 'Phone number'; w.control.attrs.role = ''; w.control.value = '+1 (202) 555-0123';
  assert.equal(w.act.verifyWrite(w.field, '+1 202-555-0123').ok, true);
  assert.equal(w.act.verifyWrite(w.field, '+1 202-555-9999').ok, false);
  assert.equal(w.act.verifyWrite(w.field, '202-555-0123').ok, false);
});

test('a committed selection does not send Escape into the surrounding application dialog', async t => {
  const w = widget(); t.after(w.cleanup);
  let dialogOpen = true;
  const handleEvent = w.control.onEvent;
  w.control.onEvent = event => {
    if (event.key === 'Escape' && w.control.getAttribute('aria-expanded') === 'false') dialogOpen = false;
    handleEvent(event);
  };
  assert.equal((await w.act.applyWrite(w.field, 'SCAD')).ok, true);
  assert.equal(dialogOpen, true);
});

test('discovery and failed selection leave a repurposed input untouched during cleanup', async t => {
  for (const operation of ['read', 'write']) {
    const w = widget(); t.after(w.cleanup);
    const handleEvent = w.control.onEvent;
    w.control.onEvent = event => {
      handleEvent(event);
      if (event.type === 'input' && w.control.value === 'SCAD') {
        w.scan.scanFields = () => [{ ...w.field, label: 'Different question' }];
        w.scan.pageSignature = () => 'changed-form';
      }
    };
    if (operation === 'read') assert.equal((await w.act.readOptions(w.field, { query: 'SCAD' })).length, 0);
    else assert.equal((await w.act.applyWrite(w.field, 'SCAD')).ok, false);
    assert.equal(w.control.value, 'SCAD', `${operation} must not restore a value into a different question`);
  }
});

test('a manual correction clears the failed-selection marker', async t => {
  const w = widget({ ignoreClick: true }); t.after(w.cleanup);
  assert.equal((await w.act.applyWrite(w.field, 'SCAD')).ok, false);
  w.edit('SCAD');
  assert.equal(w.act.verifyWrite(w.field, 'SCAD').ok, true);
  assert.equal(w.act.canAutomate(w.field), false);
});

test('mouse-down and pointer-down controls open and pointer-up options commit', async t => {
  for (const [openOn, selectOn] of [['mousedown', 'click'], ['pointerdown', 'pointerup']]) {
    const w = widget({ kind: 'button', openOn, selectOn }); t.after(w.cleanup);
    assert.ok((await w.act.readOptions(w.field)).includes('SCAD'), openOn);
    assert.equal(w.popup.visible, false, 'Escape must reach the portaled menu');
    assert.equal((await w.act.applyWrite(w.field, 'SCAD')).ok, true, selectOn);
    assert.equal(w.selected(), 'SCAD');
    assert.equal(w.act.verifyWrite(w.field, 'SCAD').ok, true);
  }
});

test('verification reads native validity without firing the site invalid event', t => {
  const w = widget(); t.after(w.cleanup);
  w.field.type = 'text'; w.control.attrs.role = ''; w.control.value = 'invalid';
  w.control.validity = { valid: false };
  w.control.checkValidity = () => { throw new Error('must not dispatch invalid events'); };
  assert.equal(w.act.verifyWrite(w.field, 'invalid').ok, false);
  w.control.validity.valid = true;
  assert.equal(w.act.verifyWrite(w.field, 'invalid').ok, true);
});

test('a written answer cannot overrun the live field limit or be silently truncated', async t => {
  const w = widget(); t.after(w.cleanup);
  w.field.type = 'text'; w.field.label = 'Why this role?'; w.control.attrs.role = ''; w.control.maxLength = 12;
  assert.equal((await w.act.applyWrite(w.field, 'An answer that is too long.')).ok, false);
  assert.equal(w.control.value, '');
  assert.equal((await w.act.applyWrite(w.field, 'Fits here.')).ok, true);
  assert.equal(w.control.value, 'Fits here.');
});
