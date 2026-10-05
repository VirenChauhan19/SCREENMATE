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
    try { el.click(); } finally { programmaticClick = false; }
  }
  const editedFields = new Set();
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
      if (field && (type === 'input' || type === 'change')) editedFields.add(fieldKey(field));
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
    return popup ? Array.from(popup.querySelectorAll('[role=option], li, button'))
      .filter((o) => !o.disabled && o.getAttribute('aria-disabled') !== 'true' && window.__screenmateScan.isVisible(o)) : [];
  }

  function closePopup(el) {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
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
  async function writeCombobox(el, value) {
    const version = interactionVersion;
    const signature = window.__screenmateScan.pageSignature();
    const changed = () => cancelled(version) || signature !== window.__screenmateScan.pageSignature();
    focusQuietly(el);
    if (!norm(value)) {
      if (el.tagName.toLowerCase() === 'input') return writeText(el, '');
      return { ok: false, reason: 'Clear this dropdown directly on the application form' };
    }

    // A typeahead is an <input> that only reveals its list once you type into
    // it. Clicking does nothing, so type first and let the menu come to us.
    const isTypeahead = el.tagName.toLowerCase() === 'input';
    const original = isTypeahead ? el.value : null;

    if (isTypeahead) {
      nativeSetter(el, "");
      fire(el, "input");
      await sleep(60);
      if (changed() || !el.isConnected) return interrupted();
      nativeSetter(el, value);
      fire(el, "input", "keyup");
      await sleep(220);
    } else {
      if (el.getAttribute('aria-expanded') !== 'true') clickControl(el);
      await sleep(160);
    }

    let popup = null, options = [], target = null;
    // Menus can mount before their remote options arrive. Wait for a match,
    // rather than treating the initial empty menu as the final answer.
    for (let i = 0; i < 24 && !target && el.isConnected; i++) {
      if (changed()) return interrupted();
      popup = popupFor(el);
      options = availableOptions(popup);
      target = options.find((o) => norm(o.getAttribute('aria-label') || o.textContent) === norm(value));
      if (!target) await sleep(100);
    }

    if (changed() || !el.isConnected) return interrupted();

    if (!target) {
      if (isTypeahead) {
        nativeSetter(el, original);
        fire(el, 'input');
      }
      closePopup(el);
      const available = options
        .slice(0, 8)
        .map((o) => cleanText(o.textContent))
        .filter(Boolean);
      return {
        ok: false,
        reason: `No option "${value}"${available.length ? ` — offered: ${available.join(", ")}` : ""}`,
      };
    }

    target.scrollIntoView?.({ block: "nearest" });
    clickControl(target);
    await sleep(140);
    return { ok: true };
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
      if (tag === 'select' && el.multiple) return { ok: false, reason: 'Choose multiple options yourself' };

      if (type === "radio") return writeRadio(el, value);
      if (type === "checkbox") return writeCheckbox(el, value);
      if (role === "radiogroup") return writeAriaRadioGroup(el, value);
      if (role === "checkbox" || role === "switch") return writeAriaCheckbox(el, value);
      if (tag === "select") return writeSelect(el, value);
      if (role === "combobox" || role === "listbox") return writeCombobox(el, value);
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
    const exact = norm(actual) === norm(expected);
    checks.push({
      label: "Value committed to the DOM",
      ok: exact,
    });

    checks.push({ label: "Field reports non-empty", ok: norm(actual).length > 0 });

    const invalid =
      el?.getAttribute?.("aria-invalid") === "true" ||
      (typeof el?.checkValidity === "function" && !el.checkValidity());
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
  async function readOptions(field) {
    const version = interactionVersion;
    const signature = window.__screenmateScan.pageSignature();
    const changed = () => cancelled(version) || signature !== window.__screenmateScan.pageSignature();
    if (!canAutomate(field)) return [];
    const el = field?.el;
    if (!el?.isConnected) return [];
    const role = (el.getAttribute("role") || "").toLowerCase();
    if (role !== "combobox" && role !== "listbox") return field.options || [];

    const wasOpen = el.getAttribute("aria-expanded") === "true";
    const isTypeahead = el.tagName.toLowerCase() === 'input';

    if (!wasOpen) {
      if (isTypeahead) {
        focusQuietly(el);
        clickControl(el);
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
      } else {
        clickControl(el);
      }
    }
    await sleep(180);

    let options = [];
    for (let i = 0; i < 15 && !options.length; i++) {
      if (changed() || !el.isConnected) return [];
      options = availableOptions(popupFor(el))
        .map((o) => cleanText(o.getAttribute('aria-label') || o.textContent))
        .filter(Boolean).slice(0, 60);
      if (!options.length) await sleep(100);
    }
    if (changed() || !el.isConnected) return [];
    if (!wasOpen) closePopup(el);
    await sleep(80);
    return options;
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
