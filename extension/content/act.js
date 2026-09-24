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
    for (const type of events) el.dispatchEvent(new Event(type, { bubbles: true }));
  };

  /**
   * A full press, in the order a pointer produces it. Widgets differ in which
   * event they act on — react-select (Greenhouse) opens on pointerdown or
   * mousedown and ignores a bare click, others wait for click — and el.click()
   * only ever sends the last one.
   */
  function press(el) {
    const init = { bubbles: true, cancelable: true, button: 0, buttons: 1, view: window };
    const pointer = (type) => {
      try {
        el.dispatchEvent(new PointerEvent(type, { ...init, pointerType: "mouse", isPrimary: true }));
      } catch {
        /* no PointerEvent: the mouse events below still go out */
      }
    };
    pointer("pointerdown");
    el.dispatchEvent(new MouseEvent("mousedown", init));
    pointer("pointerup");
    el.dispatchEvent(new MouseEvent("mouseup", init));
    el.dispatchEvent(new MouseEvent("click", init));
  }

  /** Closes an open menu the way a person would: Escape, then leave the field. */
  function dismiss(el) {
    el.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape", keyCode: 27 }),
    );
    el.blur?.();
  }

  function focusQuietly(el) {
    try {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.focus({ preventScroll: true });
    } catch {
      /* a page may block focus; the write still applies */
    }
  }

  /* ---------------- native controls ---------------- */

  const MENU =
    "[role=listbox], [class*=dropdown], [class*=suggest], [class*=autocomplete], [class*=typeahead]";
  const SUGGESTION =
    "[role=option], li, [class*=option], [class*=result] > *, [class*=location], [class*=item]";

  /**
   * The field's own container, when it carries a suggestion menu. Stops at the
   * first ancestor shared with another control, so a menu elsewhere on the
   * form is never mistaken for this field's.
   */
  function suggestionScope(el) {
    let node = el.parentElement;
    for (let depth = 0; depth < 4 && node && node !== document.body; depth++) {
      if (node.querySelectorAll("input:not([type=hidden]), select, textarea").length > 1) {
        return null;
      }
      if ([...node.querySelectorAll(MENU)].some((m) => !m.contains(el))) return node;
      node = node.parentElement;
    }
    return null;
  }

  /**
   * Some sites drive their own suggestion menu off the keyboard and wipe typed
   * text that was not picked from it — Lever's location field does exactly
   * that on blur. Nudge the menu open and pick the suggestion that starts with
   * what we typed, the way a person would. Returns the page's value, or null.
   */
  async function pickSuggestion(el, scope, value) {
    const last = value.slice(-1);
    el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: last }));
    el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: last }));

    const want = norm(value);
    const first = norm(value.split(",")[0]);
    // Menus are usually backed by a network search; allow ~3s for a slow one.
    for (let i = 0; i < 20; i++) {
      await sleep(150);
      const shown = [...scope.querySelectorAll(SUGGESTION)].filter(
        (n) =>
          n !== el &&
          !n.contains(el) &&
          norm(n.textContent) &&
          window.__screenmateScan.isVisible(n),
      );
      // Innermost only: a wrapper whose text happens to begin with the
      // suggestion (Lever's menu carries a utility class like "items-start")
      // is not the thing to click.
      const items = shown.filter((n) => !shown.some((m) => m !== n && n.contains(m)));
      const match =
        items.find((n) => norm(n.textContent) === want) ||
        items.find((n) => norm(n.textContent).startsWith(want)) ||
        (first.length >= 3 && items.find((n) => norm(n.textContent).startsWith(first)));
      if (match) {
        match.scrollIntoView?.({ block: "nearest" });
        press(match);
        await sleep(200);
        return cleanText(el.value) || null;
      }
    }
    return null;
  }

  async function writeText(el, value) {
    focusQuietly(el);
    nativeSetter(el, value);

    const scope = el.tagName === "INPUT" ? suggestionScope(el) : null;
    if (!scope) {
      // React listens for `input`; Vue and plain forms want `change` too.
      fire(el, "input", "change");
      el.blur?.();
      return { ok: true };
    }

    // Typed but not committed: a person picks from the menu before leaving
    // the field, and an early `change` reads as leaving without a choice.
    fire(el, "input");
    const chosen = await pickSuggestion(el, scope, value);
    if (!chosen) fire(el, "change");
    el.blur?.();
    // `chosen` is the site's own wording ("Atlanta, GA, USA"), which is what
    // verification has to compare against.
    return chosen ? { ok: true, chosen } : { ok: true };
  }

  function writeSelect(el, value) {
    // Clearing (a revert) means going back to the prompt option, whatever
    // value that option happens to carry.
    const match = !norm(value)
      ? el.options[0]
      : Array.from(el.options).find(
          (o) => norm(o.textContent) === norm(value) || norm(o.value) === norm(value),
        );
    if (!match) return { ok: false, reason: `No option matching "${value}"` };
    focusQuietly(el);
    nativeSetter(el, match.value);
    fire(el, "input", "change");
    return { ok: true };
  }

  function writeRadio(el, value) {
    const name = el.getAttribute("name");
    const group = name
      ? document.querySelectorAll(`input[type=radio][name="${CSS.escape(name)}"]`)
      : [el];
    const target = Array.from(group).find(
      (r) => norm(window.__screenmateScan.labelFor(r)) === norm(value),
    );
    if (!target) return { ok: false, reason: `No radio option matching "${value}"` };
    focusQuietly(target);
    target.click();
    return { ok: true };
  }

  function writeCheckbox(el, value) {
    const want = /^(checked|yes|true)$/i.test(String(value).trim());
    if (el.checked !== want) {
      focusQuietly(el);
      el.click();
    }
    return { ok: true };
  }

  /* ---------------- ARIA / custom widgets ---------------- */

  function writeAriaRadioGroup(el, value) {
    const options = Array.from(el.querySelectorAll("[role=radio]"));
    const target = options.find(
      (o) => norm(o.getAttribute("aria-label") || o.textContent) === norm(value),
    );
    if (!target) return { ok: false, reason: `No option matching "${value}"` };
    focusQuietly(target);
    target.click();
    return { ok: true };
  }

  function writeAriaCheckbox(el, value) {
    const want = /^(checked|yes|true)$/i.test(String(value).trim());
    const is = el.getAttribute("aria-checked") === "true";
    if (is !== want) {
      focusQuietly(el);
      el.click();
    }
    return { ok: true };
  }

  function writeContentEditable(el, value) {
    focusQuietly(el);
    el.textContent = value;
    fire(el, "input", "change");
    return { ok: true };
  }

  const isTypeaheadInput = (el) =>
    el.tagName.toLowerCase() === "input" &&
    Boolean(el.getAttribute("aria-autocomplete") || el.getAttribute("autocomplete") === "off");

  /** The listbox a combobox controls, wherever the page rendered it. */
  function findPopup(el) {
    const owned = el.getAttribute("aria-controls") || el.getAttribute("aria-owns") || "";
    const byId = owned ? document.getElementById(owned.split(/\s+/)[0]) : null;
    if (byId) return byId;
    const inside = el.querySelector("[role=listbox]");
    if (inside) return inside;
    // Workday portals its menus to the end of <body>.
    const loose = window.__screenmateScan.deepQueryAll("[role=listbox]");
    return loose.reverse().find((n) => window.__screenmateScan.isVisible(n)) || null;
  }

  const optionText = (o) => norm(o.getAttribute("aria-label") || o.textContent);

  /**
   * Empties a combobox, for a revert. Reports success only if it really is
   * empty: many dropdowns cannot be cleared at all once set.
   */
  async function clearCombobox(el, isTypeahead) {
    const control = el.closest("[class*=control]") || el.parentElement;
    const clear = control?.querySelector(
      "[class*=clear-indicator], [class*=clearIndicator], [aria-label^='clear' i]",
    );
    if (clear) {
      press(clear);
    } else if (isTypeahead) {
      focusQuietly(el);
      el.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Backspace", keyCode: 8 }),
      );
    }
    await sleep(150);
    dismiss(el);
    return window.__screenmateScan.currentValue(el)
      ? { ok: false, reason: "This dropdown cannot be cleared automatically — clear it on the page." }
      : { ok: true };
  }

  /**
   * Operates a combobox: open it, wait for the popup and its options, pick the
   * matching one. Async because the popup is usually not in the DOM until the
   * trigger is pressed, and searchable lists fill in over the network.
   */
  async function writeCombobox(el, value) {
    focusQuietly(el);

    // A typeahead is an <input> that filters its list as you type.
    const isTypeahead = isTypeaheadInput(el);

    // A revert means emptying the control. Matching "" would pick whichever
    // option happens to start with it — the first one.
    if (!norm(value)) return clearCombobox(el, isTypeahead);

    // Open it first. react-select only shows a menu once pressed; a typeahead
    // that opens as you type just ignores the press.
    press(el);
    await sleep(160);
    if (isTypeahead) {
      nativeSetter(el, "");
      fire(el, "input");
      await sleep(60);
      nativeSetter(el, value);
      fire(el, "input", "keyup");
      await sleep(220);
    }

    const want = norm(value);
    const pick = (options) =>
      options.find((o) => optionText(o) === want) ||
      options.find((o) => optionText(o).startsWith(want));

    let popup = null;
    let options = [];
    let target = null;
    // Up to ~2.5s: a search-backed list shows "Loading…" before its options.
    for (let i = 0; i < 25 && !target; i++) {
      popup = findPopup(el);
      options = popup ? Array.from(popup.querySelectorAll("[role=option], li, button")) : [];
      target = pick(options);
      if (!target) await sleep(100);
    }

    if (!popup) {
      if (isTypeahead) {
        // The text is in the field even without a menu; verification decides.
        fire(el, "change");
        el.blur?.();
        return { ok: true, note: "typed without a suggestion list" };
      }
      press(el); // close whatever we opened
      return { ok: false, reason: "Dropdown did not open" };
    }

    if (!target) {
      const available = options
        .slice(0, 8)
        .map((o) => cleanText(o.textContent))
        .filter(Boolean);
      if (isTypeahead) {
        fire(el, "change");
        el.blur?.();
        await sleep(120);
        // A free-text typeahead keeps what was typed. A pick-only one
        // (react-select) empties it — say plainly that there was no such option.
        if (norm(window.__screenmateScan.currentValue(el))) {
          return { ok: true, note: "typed; no exact suggestion offered" };
        }
        return { ok: false, reason: `No option "${value}" in this list` };
      }
      press(el);
      return {
        ok: false,
        reason: `No option "${value}"${available.length ? ` — offered: ${available.join(", ")}` : ""}`,
      };
    }

    target.scrollIntoView?.({ block: "nearest" });
    press(target);
    await sleep(160);
    if (isTypeahead) el.blur?.();
    return { ok: true, chosen: cleanText(target.getAttribute("aria-label") || target.textContent) };
  }

  /**
   * Applies one write. Never throws — a hostile or merely unusual page must not
   * take the whole run down.
   */
  async function applyWrite(field, value) {
    const el = field.el;
    if (!el || !el.isConnected) {
      return { ok: false, reason: "Element left the page before the write" };
    }
    try {
      const tag = el.tagName.toLowerCase();
      const role = (el.getAttribute("role") || "").toLowerCase();
      const type = (el.type || "").toLowerCase();

      if (type === "radio") return writeRadio(el, value);
      if (type === "checkbox") return writeCheckbox(el, value);
      if (role === "radiogroup") return writeAriaRadioGroup(el, value);
      if (role === "checkbox" || role === "switch") return writeAriaCheckbox(el, value);
      if (tag === "select") return writeSelect(el, value);
      if (role === "combobox" || role === "listbox") return writeCombobox(el, value);
      if (el.isContentEditable) return writeContentEditable(el, value);
      return await writeText(el, value);
    } catch (err) {
      return { ok: false, reason: err?.message || "Write threw" };
    }
  }

  /**
   * Re-reads the DOM after a write. Deliberately independent of what applyWrite
   * reported: we check the page, not our own optimism.
   */
  function verifyWrite(field, expected) {
    const el = field.el;
    const checks = [];

    checks.push({ label: "Element still in page", ok: Boolean(el?.isConnected) });

    const actual = el?.isConnected ? window.__screenmateScan.currentValue(el) : "";
    // Custom widgets often render a decorated label ("No — I do not require…"),
    // so a prefix match is the honest bar for them.
    const exact = norm(actual) === norm(expected);
    const loose =
      norm(actual).startsWith(norm(expected)) ||
      norm(expected).startsWith(norm(actual));
    checks.push({
      label: "Value committed to the DOM",
      ok: exact || (loose && norm(actual).length > 0),
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
    const el = field?.el;
    if (!el?.isConnected) return [];
    const role = (el.getAttribute("role") || "").toLowerCase();
    if (role !== "combobox" && role !== "listbox") return field.options || [];

    const wasOpen = el.getAttribute("aria-expanded") === "true";
    const isTypeahead = isTypeaheadInput(el);
    const restore = isTypeahead ? el.value : null;

    if (!wasOpen) {
      focusQuietly(el);
      // react-select opens on a press; a type-to-open list on empty input.
      press(el);
      if (isTypeahead) {
        nativeSetter(el, "");
        fire(el, "input");
      }
      await sleep(200);
    }

    let options = [];
    for (let i = 0; i < 6 && !options.length; i++) {
      await sleep(i ? 120 : 180);
      const popup = findPopup(el);
      options = popup
        ? Array.from(popup.querySelectorAll("[role=option], li"))
            .map((o) => cleanText(o.getAttribute("aria-label") || o.textContent))
            .filter(Boolean)
            .slice(0, 60)
        : [];
    }

    if (isTypeahead) {
      // Put back whatever the user had typed before we probed, and close.
      nativeSetter(el, restore || "");
      fire(el, "input");
      if (!wasOpen) dismiss(el);
    } else if (!wasOpen && el.getAttribute("aria-expanded") === "true") {
      press(el);
    }
    await sleep(80);
    return options;
  }

  window.__screenmateAct = {
    applyWrite,
    verifyWrite,
    highlight,
    focusQuietly,
    readOptions,
  };
})();
