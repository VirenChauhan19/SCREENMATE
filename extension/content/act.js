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

  function focusQuietly(el) {
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
    const match = Array.from(el.options).find(
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

  /**
   * Operates a button+listbox combobox: open it, wait for the popup to render,
   * click the matching option. Async because the popup is usually not in the DOM
   * until the trigger is clicked.
   */
  async function writeCombobox(el, value) {
    focusQuietly(el);

    // A typeahead is an <input> that only reveals its list once you type into
    // it. Clicking does nothing, so type first and let the menu come to us.
    const isTypeahead =
      el.tagName.toLowerCase() === "input" &&
      (el.getAttribute("aria-autocomplete") || el.getAttribute("autocomplete") === "off");

    if (isTypeahead) {
      nativeSetter(el, "");
      fire(el, "input");
      await sleep(60);
      nativeSetter(el, value);
      fire(el, "input", "keyup");
      await sleep(220);
    } else {
      el.click();
      await sleep(160);
    }

    const findPopup = () => {
      const owned =
        el.getAttribute("aria-controls") || el.getAttribute("aria-owns") || "";
      const byId = owned ? document.getElementById(owned.split(/\s+/)[0]) : null;
      if (byId) return byId;
      const inside = el.querySelector("[role=listbox]");
      if (inside) return inside;
      // Workday portals its menus to the end of <body>.
      const loose = window.__screenmateScan.deepQueryAll("[role=listbox]");
      return loose.reverse().find((n) => window.__screenmateScan.isVisible(n)) || null;
    };

    let popup = null;
    for (let i = 0; i < 14 && !popup; i++) {
      popup = findPopup();
      if (!popup) await sleep(90);
    }
    if (!popup) {
      if (isTypeahead) {
        // The text is in the field even without a menu; verification decides.
        fire(el, "change");
        el.blur?.();
        return { ok: true, note: "typed without a suggestion list" };
      }
      el.click(); // close whatever we opened
      return { ok: false, reason: "Dropdown did not open" };
    }

    const options = Array.from(popup.querySelectorAll("[role=option], li, button"));
    const target =
      options.find(
        (o) => norm(o.getAttribute("aria-label") || o.textContent) === norm(value),
      ) ||
      options.find((o) =>
        norm(o.getAttribute("aria-label") || o.textContent).startsWith(norm(value)),
      );

    if (!target) {
      if (isTypeahead) {
        fire(el, "change");
        el.blur?.();
        return { ok: true, note: "typed; no exact suggestion offered" };
      }
      el.click();
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
    target.click();
    await sleep(140);
    return { ok: true };
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
      return writeText(el, value);
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
    const isTypeahead =
      el.tagName.toLowerCase() === "input" &&
      (el.getAttribute("aria-autocomplete") || el.getAttribute("autocomplete") === "off");
    const restore = isTypeahead ? el.value : null;

    if (!wasOpen) {
      if (isTypeahead) {
        focusQuietly(el);
        nativeSetter(el, "");
        fire(el, "input");
        await sleep(200);
      } else {
        el.click();
      }
    }
    await sleep(180);

    const owned =
      el.getAttribute("aria-controls") || el.getAttribute("aria-owns") || "";
    const popup =
      (owned ? document.getElementById(owned.split(/\s+/)[0]) : null) ||
      el.querySelector("[role=listbox]") ||
      window.__screenmateScan
        .deepQueryAll("[role=listbox]")
        .reverse()
        .find((n) => window.__screenmateScan.isVisible(n));

    const options = popup
      ? Array.from(popup.querySelectorAll("[role=option], li"))
          .map((o) => cleanText(o.getAttribute("aria-label") || o.textContent))
          .filter(Boolean)
          .slice(0, 60)
      : [];

    if (isTypeahead) {
      // Put back whatever the user had typed before we probed.
      nativeSetter(el, restore || "");
      fire(el, "input");
    } else if (!wasOpen && el.getAttribute("aria-expanded") === "true") {
      el.click();
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
