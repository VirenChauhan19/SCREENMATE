/**
 * Tool execution against a live DOM, plus verification.
 *
 * The web app's executeAction mutates React state and then re-reads that state.
 * Here the environment is the page itself: we write through the native setter,
 * fire the events a framework listens for, and then re-read the DOM to confirm
 * the value actually stuck. A framework that rejects our write is the exact
 * failure verification exists to catch.
 */

(() => {
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
    for (const type of events) {
      el.dispatchEvent(new Event(type, { bubbles: true }));
    }
  };

  function focusQuietly(el) {
    try {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.focus({ preventScroll: true });
    } catch {
      /* a page may block focus; the write still applies */
    }
  }

  function writeText(el, value) {
    focusQuietly(el);
    nativeSetter(el, value);
    // React listens for `input`; Vue and plain forms want `change` too.
    fire(el, "input", "change");
    el.blur?.();
  }

  function writeSelect(el, value) {
    const match = Array.from(el.options).find(
      (o) =>
        o.textContent.trim().toLowerCase() === value.trim().toLowerCase() ||
        o.value.trim().toLowerCase() === value.trim().toLowerCase(),
    );
    if (!match) return false;
    focusQuietly(el);
    nativeSetter(el, match.value);
    fire(el, "input", "change");
    return true;
  }

  function writeRadio(el, value) {
    const name = el.getAttribute("name");
    const group = name
      ? document.querySelectorAll(`input[type=radio][name="${CSS.escape(name)}"]`)
      : [el];
    const target = Array.from(group).find(
      (r) =>
        window.__screenmateScan.labelFor(r).trim().toLowerCase() ===
        value.trim().toLowerCase(),
    );
    if (!target) return false;
    focusQuietly(target);
    target.click();
    return true;
  }

  function writeCheckbox(el, value) {
    const want = /^(checked|yes|true)$/i.test(value.trim());
    if (el.checked !== want) {
      focusQuietly(el);
      el.click();
    }
    return true;
  }

  /**
   * Applies one write. Returns { ok, reason } — it never throws, because a
   * hostile or merely unusual page must not take the whole run down.
   */
  function applyWrite(field, value) {
    const el = field.el;
    if (!el || !el.isConnected) {
      return { ok: false, reason: "Element left the page before the write" };
    }
    try {
      const type = (el.type || "").toLowerCase();
      if (type === "radio") {
        return writeRadio(el, value)
          ? { ok: true }
          : { ok: false, reason: `No radio option matching "${value}"` };
      }
      if (type === "checkbox") {
        return writeCheckbox(el, value) ? { ok: true } : { ok: false };
      }
      if (el.tagName.toLowerCase() === "select") {
        return writeSelect(el, value)
          ? { ok: true }
          : { ok: false, reason: `No option matching "${value}"` };
      }
      writeText(el, value);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err?.message || "Write threw" };
    }
  }

  /**
   * Re-reads the DOM after a write. This is deliberately independent of what
   * applyWrite reported: we check the page, not our own optimism.
   */
  function verifyWrite(field, expected) {
    const el = field.el;
    const checks = [];

    checks.push({ label: "Element still in page", ok: Boolean(el?.isConnected) });

    const actual = el?.isConnected
      ? window.__screenmateScan.currentValue(el)
      : "";
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
    checks.push({
      label: "Value committed to the DOM",
      ok: norm(actual) === norm(expected),
    });

    checks.push({
      label: "Field reports non-empty",
      ok: norm(actual).length > 0,
    });

    // A framework that rejected the write usually marks the field invalid.
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

  window.__screenmateAct = { applyWrite, verifyWrite, highlight, focusQuietly };
})();
