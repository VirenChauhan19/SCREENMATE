/**
 * Tool execution against a live DOM, plus verification.
 *
 * The web app's executeAction mutates React state and re-reads that state. Here
 * the environment is the page itself: we write through the native setter, fire
 * the events a framework listens for, then re-read the DOM to confirm the value
 * stuck. A framework that rejects our write is exactly what verification exists
 * to catch.
 *
 * Custom widgets (Workday-style button + listbox) can't be written at all — they
 * have to be operated, so we click them the way a person would.
 */

(() => {
  const { cleanText } = window.__screenmateScan;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => cleanText(s || "").toLowerCase();
  let interactionVersion = 0;
  let userFocus = null;
  let programmaticClick = false;
  function clickControl(el) {
    programmaticClick = true;
    try {
      // Custom selects often open on mousedown or pointerdown and select on
      // pointerup. HTMLElement.click() alone skips those widget handlers.
      const bounds = el.getBoundingClientRect?.();
      const eventOptions = { bubbles: true, cancelable: true, composed: true,
        button: 0, buttons: 1, ctrlKey: false,
        clientX: bounds ? bounds.left + bounds.width / 2 : 0,
        clientY: bounds ? bounds.top + bounds.height / 2 : 0 };
      let compatibilityMouse = true;
      if (typeof PointerEvent === 'function') compatibilityMouse = el.dispatchEvent(new PointerEvent('pointerdown', {
        ...eventOptions, pointerId: 1, pointerType: 'mouse', isPrimary: true,
      }));
      if (compatibilityMouse && typeof MouseEvent === 'function') el.dispatchEvent(new MouseEvent('mousedown', eventOptions));
      if (!el.isConnected) return;
      if (typeof PointerEvent === 'function') el.dispatchEvent(new PointerEvent('pointerup', {
        ...eventOptions, buttons: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true,
      }));
      if (!el.isConnected) return;
      if (compatibilityMouse && typeof MouseEvent === 'function') el.dispatchEvent(new MouseEvent('mouseup', { ...eventOptions, buttons: 0 }));
      if (el.isConnected) el.click();
    } finally { programmaticClick = false; }
  }
  const editedFields = new Set();
  const selections = new WeakMap();
  const interactionListeners = new Set();
  const fieldKey = field => `${location.href}:${field.id}:${field.label}:${field.type}`;
  const cancelled = version => version !== interactionVersion;
  const interrupted = () => ({ ok: false, reason: 'You interacted with the page; rescanning before continuing', interrupted: true });

  function canAutomate(field) {
    const el = resolveField(field);
    return Boolean(el && !editedFields.has(fieldKey(field)) &&
      !(userFocus?.isConnected && ['combobox', 'listbox'].includes(el.getAttribute('role'))) &&
      !(userFocus?.isConnected && (userFocus === el || el.contains(userFocus))));
  }

  for (const type of ['pointerdown', 'keydown', 'input', 'change', 'wheel']) {
    document.addEventListener(type, event => {
      if (programmaticClick || !event.isTrusted || event.composedPath().some(node => node.id === 'screenmate-root')) return;
      interactionVersion++;
      const path = event.composedPath();
      const field = window.__screenmateScan.scanFields().find(f => path.includes(f.el) || path.some(node => node instanceof Element && f.el.contains(node)));
      if (type !== 'wheel') userFocus = field?.el || null;
      if (field && (type === 'input' || type === 'change')) {
        editedFields.add(fieldKey(field));
        selections.delete(field.el);
      }
      for (const listener of interactionListeners) listener({ field, type });
    }, { capture: true, passive: type === 'wheel' });
  }
  document.addEventListener('focusout', event => {
    if (event.composedPath().includes(userFocus)) userFocus = null;
  }, true);

  const nativeSetter = (el, value) => {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : el instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
  };

  const fire = (el, ...events) => {
    for (const type of events) el.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
  };

  function focusQuietly(el) {
    if (userFocus?.isConnected && userFocus !== el) return;
    try {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.focus({ preventScroll: true });
    } catch {
      /* a page may block focus; the write still applies */
    }
  }

  /* ---------------- native controls ---------------- */

  function writeText(el, value) {
    focusQuietly(el);
    nativeSetter(el, value);
    // React listens for `input`; Vue and plain forms want `change` too.
    fire(el, "input", "change");
    el.blur?.();
    return { ok: true };
  }

  function writeSelect(el, value) {
    const match = !norm(value) ? Array.from(el.options).find(window.__screenmateScan.isPlaceholderOption) : Array.from(el.options).find(
      (o) => !window.__screenmateScan.isPlaceholderOption(o) &&
        (norm(o.textContent) === norm(value) || norm(o.value) === norm(value)),
    );
    if (!match) return { ok: false, reason: `No option matching "${value}"` };
    focusQuietly(el);
    nativeSetter(el, match.value);
    fire(el, "input", "change");
    return { ok: true };
  }

  function writeRadio(el, value) {
    const group = window.__screenmateScan.radioMembers(el);
    const target = Array.from(group).find(
      (r) => !r.disabled && norm(window.__screenmateScan.labelFor(r)) === norm(value),
    );
    if (!target) return { ok: false, reason: `No radio option matching "${value}"` };
    focusQuietly(target);
    clickControl(target);
    return { ok: true };
  }

  function writeCheckbox(el, value) {
    const want = /^(checked|yes|true)$/i.test(String(value).trim());
    if (el.checked !== want) {
      focusQuietly(el);
      clickControl(el);
    }
    return { ok: true };
  }

  /* ---------------- ARIA / custom widgets ---------------- */

  function popupFor(el) {
    const scan = window.__screenmateScan;
    const owned = (el.getAttribute('aria-controls') || el.getAttribute('aria-owns') || '').split(/\s+/);
    const linked = owned.map((id) => scan.referencedElement(el, id)).find((n) => n && scan.isVisible(n));
    if (linked) return linked;
    const inside = el.querySelector('[role=listbox]');
    if (inside && scan.isVisible(inside)) return inside;
    // Without an explicit association, only one visible menu is unambiguous.
    const loose = scan.deepQueryAll('[role=listbox]').filter(scan.isVisible);
    return loose.length === 1 ? loose[0] : null;
  }

  function availableOptions(popup) {
    if (!popup) return [];
    const semantic = popup.querySelectorAll('[role=option]');
    return Array.from(semantic.length ? semantic : popup.querySelectorAll('li, button'))
      .filter((o) => !o.disabled && o.getAttribute('aria-disabled') !== 'true' && window.__screenmateScan.isVisible(o));
  }

  const optionText = node => cleanText(node.getAttribute('aria-label') || node.textContent);

  function menuScroller(popup) {
    if (!popup) return null;
    return [popup, ...popup.querySelectorAll('*')].find(node => node.clientHeight > 0 && node.scrollHeight > node.clientHeight + 4) || null;
  }

  function scrollMenu(popup, reset = false) {
    const scroller = menuScroller(popup);
    if (!scroller) return false;
    const before = scroller.scrollTop;
    scroller.scrollTop = reset ? 0 : Math.min(scroller.scrollHeight - scroller.clientHeight, before + Math.max(40, scroller.clientHeight * .85));
    if (scroller.scrollTop === before) return false;
    fire(scroller, 'scroll');
    return true;
  }

  function searchInput(el) {
    if (el.tagName === 'INPUT' && !el.readOnly) return el;
    const inputs = popupFor(el)?.querySelectorAll('input:not([type]), input[type="text"], input[type="search"]');
    return inputs?.length === 1 && !inputs[0].disabled && !inputs[0].readOnly ? inputs[0] : null;
  }

  function closePopup(el) {
    // Selection often dismisses the menu itself. An extra Escape can bubble
    // into an employer's enclosing application dialog and close that too.
    if (el.getAttribute('aria-expanded') === 'false' ||
      (el.getAttribute('aria-expanded') !== 'true' && !popupFor(el))) return;
    const popup = popupFor(el);
    const active = document.activeElement;
    const activeInput = active?.tagName === 'INPUT' && (active === el || el.contains(active));
    const target = active && (activeInput || popup?.contains(active)) ? active : el.tagName === 'INPUT' ? el : popup || el;
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true, composed: true }));
    if (el.tagName.toLowerCase() !== 'input' && el.getAttribute('aria-expanded') === 'true') clickControl(el);
    el.blur?.();
  }

  function writeAriaRadioGroup(el, value) {
    const options = Array.from(el.querySelectorAll("[role=radio]"));
    const target = options.find(
      (o) => norm(o.getAttribute("aria-label") || o.textContent) === norm(value),
    );
    if (!target) return { ok: false, reason: `No option matching "${value}"` };
    focusQuietly(target);
    clickControl(target);
    return { ok: true };
  }

  function writeAriaCheckbox(el, value) {
    const want = /^(checked|yes|true)$/i.test(String(value).trim());
    const is = el.getAttribute("aria-checked") === "true";
    if (is !== want) {
      focusQuietly(el);
      clickControl(el);
    }
    return { ok: true };
  }

  function writeContentEditable(el, value) {
    focusQuietly(el);
    el.textContent = value;
    fire(el, "input", "change");
    return { ok: true };
  }

  /**
   * Operates a button+listbox combobox: open it, wait for the popup to render,
   * click the matching option. Async because the popup is usually not in the DOM
   * until the trigger is clicked.
   */
  async function writeCombobox(el, value, field) {
    const version = interactionVersion;
    const signature = window.__screenmateScan.pageSignature();
    const changed = () => cancelled(version) || signature !== window.__screenmateScan.pageSignature();
    focusQuietly(el);
    if (!norm(value)) {
      if (el.tagName.toLowerCase() === 'input') return writeText(el, '');
      return { ok: false, reason: 'Clear this dropdown directly on the application form' };
    }

    let input = null, original = '', typed = false, committed = false;
    selections.set(el, { expected: value, committed: false });
    try {
      if (el.getAttribute('aria-expanded') !== 'true') clickControl(el);
      await sleep(100);
      let popup = null, options = [], target = null, scrolls = 0, searched = false, resetScroll = false;
      for (let i = 0; i < 80 && !target && el.isConnected; i++) {
        if (changed()) return interrupted();
        if (!searched && (input = searchInput(el))) {
          original = input.value;
          nativeSetter(input, value);
          typed = searched = true;
          fire(input, 'input', 'change');
          await sleep(220);
          if (changed()) return interrupted();
        }
        popup = popupFor(el);
        if (popup && !resetScroll) {
          resetScroll = true;
          if (scrollMenu(popup, true)) { await sleep(100); continue; }
        }
        options = availableOptions(popup);
        const matches = options.filter(option => norm(optionText(option)) === norm(value));
        if (matches.length > 1) return { ok: false, reason: 'Several identical choices are present; choose this option directly.' };
        target = matches[0];
        if (!target) {
          if (options.length && scrolls < 64 && scrollMenu(popup)) scrolls++;
          await sleep(100);
        }
      }
      if (changed() || !el.isConnected) return interrupted();
      if (!target) return { ok: false, reason: `No option matching "${value}" in this dropdown` };
      target.scrollIntoView?.({ block: 'nearest' });
      const clickedPopup = popup;
      clickControl(target);
      // Query text alone does not prove a selection. Wait for a committed
      // selected value or for the actual menu to close after the click.
      for (let i = 0; i < 18; i++) {
        if (cancelled(version)) return interrupted();
        if (!el.isConnected) {
          const replacement = field && resolveField(field);
          if (!replacement) return { ok: false, reason: 'The field changed before its selection could be confirmed.' };
          el = replacement;
        }
        const actual = window.__screenmateScan.currentValue(el);
        const menuClosed = el.getAttribute('aria-expanded') === 'false' ||
          Boolean(clickedPopup && (!clickedPopup.isConnected || !window.__screenmateScan.isVisible(clickedPopup)));
        const selectedMarker = target.isConnected && target.getAttribute('aria-selected') === 'true';
        const separateValue = el.tagName === 'INPUT' && norm(actual) !== norm(el.value);
        if (norm(actual) === norm(value) && (menuClosed || selectedMarker || separateValue)) {
          committed = true;
          selections.set(el, { expected: value, committed: true });
          return { ok: true };
        }
        await sleep(80);
      }
      return { ok: false, reason: 'The option was clicked but the site did not confirm the selection.' };
    } finally {
      if (!cancelled(version) && el.isConnected && resolveField(field) === el) {
        if (!committed && typed && input?.isConnected && searchInput(el) === input && input.value === value) {
          nativeSetter(input, original);
          fire(input, 'input');
        }
        closePopup(el);
      }
    }
  }

  /**
   * Applies one write. Never throws — a hostile or merely unusual page must not
   * take the whole run down.
   */
  function resolveField(field) {
    // A dependent question may reuse the same connected input for a new
    // question. Its old classification no longer authorizes a write.
    const replacement = window.__screenmateScan.scanFields().find((f) =>
      f.id === field?.id && f.label === field?.label && f.type === field?.type);
    if (replacement) field.el = replacement.el;
    return replacement?.el;
  }

  async function applyWrite(field, value, { automatic = false } = {}) {
    try {
      if (automatic && !canAutomate(field)) return { ok: false, reason: 'Keeping the field you are editing', interrupted: true };
      const el = resolveField(field);
      if (!el || !el.isConnected) {
        return { ok: false, reason: 'Field changed or left the page; rescan before writing' };
      }
      if (!window.__screenmateScan.isVisible(el)) return { ok: false, reason: 'Field is hidden, disabled, or read-only' };
      const tag = el.tagName.toLowerCase();
      const role = (el.getAttribute("role") || "").toLowerCase();
      const type = (el.type || "").toLowerCase();
      if (type === 'file') return { ok: false, reason: 'Choose the document yourself' };
      if (field.type !== 'select' && Number.isInteger(el.maxLength) && el.maxLength >= 0 && String(value).length > el.maxLength) {
        return { ok: false, reason: `This answer exceeds the field's ${el.maxLength}-character limit. Shorten the answer before filling it.` };
      }
      if (tag === 'select' && el.multiple) return { ok: false, reason: 'Choose multiple options yourself' };

      if (type === "radio") return writeRadio(el, value);
      if (type === "checkbox") return writeCheckbox(el, value);
      if (role === "radiogroup") return writeAriaRadioGroup(el, value);
      if (role === "checkbox" || role === "switch") return writeAriaCheckbox(el, value);
      if (tag === "select") return writeSelect(el, value);
      if (role === "combobox" || role === "listbox") return writeCombobox(el, value, field);
      if (el.isContentEditable) return writeContentEditable(el, value);
      if (tag === 'input' || tag === 'textarea') return writeText(el, value);
      return { ok: false, reason: 'This custom text control needs manual input' };
    } catch (err) {
      return { ok: false, reason: err?.message || "Write threw" };
    }
  }

  /**
   * Re-reads the DOM after a write. Deliberately independent of what applyWrite
   * reported: we check the page, not our own optimism.
   */
  function verifyWrite(field, expected) {
    const el = resolveField(field);
    const checks = [];

    checks.push({ label: "Element still in page", ok: Boolean(el?.isConnected) });

    const actual = el?.isConnected ? window.__screenmateScan.currentValue(el) : "";
    const phone = field.type !== 'select' && /\b(phone|telephone|mobile)\b/i.test(field.label) && !/\b(type|code|extension|ext)\b/i.test(field.label);
    const digits = value => String(value || '').replace(/\D/g, '');
    const exact = norm(actual) === norm(expected) || (phone && digits(expected).length >= 7 && digits(actual) === digits(expected));
    checks.push({
      label: "Value committed to the DOM",
      ok: exact,
    });

    checks.push({ label: "Field reports non-empty", ok: norm(actual).length > 0 });
    const selection = el && selections.get(el);
    if (selection && norm(selection.expected) === norm(expected)) {
      checks.push({ label: 'Dropdown selection confirmed', ok: selection.committed });
    }

    const invalid =
      el?.getAttribute?.("aria-invalid") === "true" ||
      el?.validity?.valid === false;
    checks.push({ label: "No validation error raised", ok: !invalid });

    const ok = checks.every((c) => c.ok);
    return {
      ok,
      checks,
      actual,
      summary: ok
        ? "Field update confirmed"
        : checks.find((c) => !c.ok)?.label || "Verification failed",
    };
  }

  function highlight(el) {
    if (!el?.isConnected) return;
    el.classList.add("screenmate-touched");
    setTimeout(() => el.classList.remove("screenmate-touched"), 1600);
  }

  /**
   * Reads a custom dropdown's choices by briefly opening it.
   *
   * A combobox keeps its options out of the DOM until it opens, so without this
   * the UI has to guess — and guessing "Yes/No" on an ethnicity question is how
   * you write a wrong answer into a protected field.
   */
  async function readOptions(field, { query = '' } = {}) {
    const version = interactionVersion;
    const signature = window.__screenmateScan.pageSignature();
    const changed = () => cancelled(version) || signature !== window.__screenmateScan.pageSignature();
    if (!canAutomate(field)) return [];
    const el = field?.el;
    if (!el?.isConnected) return [];
    const role = (el.getAttribute("role") || "").toLowerCase();
    if (role !== "combobox" && role !== "listbox") return field.options || [];

    const wasOpen = el.getAttribute('aria-expanded') === 'true';
    let input = null, original = '', typed = false;
    const found = new Set();
    try {
      if (!wasOpen) {
        focusQuietly(el);
        clickControl(el);
        if (el.tagName === 'INPUT') el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
      }
      await sleep(160);
      let idle = 0, resetScroll = false;
      for (let i = 0; i < 80 && found.size < 300; i++) {
        if (changed() || !el.isConnected) return [];
        if (query && !typed && (input = searchInput(el))) {
          original = input.value;
          nativeSetter(input, query);
          typed = true;
          fire(input, 'input', 'change');
          await sleep(220);
          if (changed()) return [];
        }
        const popup = popupFor(el);
        if (popup && !resetScroll) {
          resetScroll = true;
          if (scrollMenu(popup, true)) { await sleep(100); continue; }
        }
        const previous = found.size;
        for (const option of availableOptions(popup)) {
          const label = optionText(option);
          if (label) found.add(label);
        }
        const scrolled = scrollMenu(popup);
        idle = found.size === previous && !scrolled ? idle + 1 : 0;
        if (found.size && idle >= 3) break;
        await sleep(100);
      }
      return [...found].slice(0, 300);
    } finally {
      if (!cancelled(version) && el.isConnected && resolveField(field) === el) {
        if (typed && input?.isConnected && searchInput(el) === input && input.value === query) {
          nativeSetter(input, original);
          fire(input, 'input');
        }
        if (!wasOpen) closePopup(el);
      }
    }
  }

  window.__screenmateAct = {
    applyWrite,
    verifyWrite,
    highlight,
    focusQuietly,
    readOptions,
    canAutomate,
    onInteraction: listener => interactionListeners.add(listener),
    isEditing: () => Boolean(userFocus?.isConnected),
    keepField: field => editedFields.add(fieldKey(field)),
  };
})();
