/**
 * Multi-page navigation.
 *
 * A real application is a wizard: fill a step, advance, fill the next. The agent
 * is allowed to advance. It is never allowed to submit.
 *
 * That line is enforced here rather than left to the model, because the failure
 * mode is irreversible — a submitted job application cannot be taken back.
 */

(() => {
  const { cleanText, deepQueryAll, isVisible } = window.__screenmateScan;
  const norm = (s) => cleanText(s || "").toLowerCase();

  /**
   * Anything that could finalise the application. Checked first and independently
   * of the advance list, so a button reading "Submit and continue" is refused.
   */
  const SUBMIT_RE =
    /\b(submit|apply now|send application|finish|complete application|confirm and|agree and|i agree|accept and|sign and|pay|purchase|delete|withdraw)\b/i;

  /** Controls that move to the next step of a wizard. */
  const ADVANCE_RE =
    /\b(next|continue|save and continue|save & continue|proceed|next step|move on|go to next)\b/i;

  /** Controls that move backwards or abandon — never clicked automatically. */
  const RETREAT_RE = /\b(back|previous|cancel|discard|start over|sign out|log ?out)\b/i;

  const CLICKABLE = [
    "button",
    "[role=button]",
    "input[type=button]",
    "input[type=submit]",
    "a[href]",
  ].join(",");

  function controlText(el) {
    return cleanText(
      el.getAttribute("aria-label") ||
        el.value ||
        el.textContent ||
        el.getAttribute("title") ||
        "",
    );
  }

  /** True if this control could finalise the application. */
  function isSubmitControl(el) {
    const text = controlText(el);
    const hook = `${el.getAttribute("data-automation-id") || ""} ${el.id || ""} ${
      el.getAttribute("name") || ""
    }`;
    return SUBMIT_RE.test(text) || SUBMIT_RE.test(hook);
  }

  /**
   * Finds the control that advances to the next step, or null.
   * Returns null rather than guessing: a wrong click here is unrecoverable.
   */
  function findAdvanceControl() {
    const candidates = deepQueryAll(CLICKABLE).filter((el) => {
      if (!isVisible(el)) return false;
      if (el.disabled || el.getAttribute("aria-disabled") === "true") return false;
      return true;
    });

    const scored = [];
    for (const el of candidates) {
      const text = controlText(el);
      if (!text || text.length > 60) continue;
      if (isSubmitControl(el)) continue;
      if (RETREAT_RE.test(text)) continue;
      if (!ADVANCE_RE.test(text)) continue;

      // Prefer an explicit primary action near the end of the form.
      let score = 0;
      if (/^(next|continue|save and continue|save & continue)$/i.test(text)) score += 3;
      if (/primary|submit-button|next/i.test(el.className || "")) score += 1;
      if ((el.getAttribute("data-automation-id") || "").match(/next|continue/i)) {
        score += 2;
      }
      if (el.tagName.toLowerCase() === "button") score += 1;
      scored.push({ el, text, score });
    }

    if (scored.length === 0) return null;
    scored.sort((a, b) => b.score - a.score);
    return scored[0];
  }

  /** Reports the submit control, if the page is showing one, for the handoff. */
  function findSubmitControl() {
    const el = deepQueryAll(CLICKABLE).find(
      (n) => isVisible(n) && isSubmitControl(n) && controlText(n).length < 60,
    );
    return el ? { el, text: controlText(el) } : null;
  }

  /**
   * Clicks `control` and waits for the page to actually become a different page.
   * Resolves with the outcome rather than throwing, so the loop can report and
   * stop cleanly when a wizard refuses to advance (usually a validation error).
   */
  async function advance(control, { timeout = 15000 } = {}) {
    if (!control?.el?.isConnected) {
      return { ok: false, reason: "Advance control disappeared" };
    }
    if (isSubmitControl(control.el)) {
      // Belt and braces: findAdvanceControl already excluded these.
      return { ok: false, reason: "Refusing to click a submit control" };
    }

    const before = window.__screenmateScan.pageSignature();
    control.el.scrollIntoView?.({ block: "center", behavior: "smooth" });
    await new Promise((r) => setTimeout(r, 250));
    control.el.click();

    const started = Date.now();
    let settledFor = 0;
    let last = before;

    while (Date.now() - started < timeout) {
      await new Promise((r) => setTimeout(r, 350));
      const now = window.__screenmateScan.pageSignature();

      if (now !== before) {
        // Changed — now wait for it to stop changing before we scan.
        settledFor = now === last ? settledFor + 350 : 0;
        last = now;
        if (settledFor >= 700) return { ok: true };
      }
      last = now;
    }

    // The signature never changed. Almost always the wizard blocked us with a
    // validation error, which is information, not a crash.
    return {
      ok: false,
      reason: "Page did not change — the form may be blocking on a validation error",
    };
  }

  window.__screenmateNav = {
    findAdvanceControl,
    findSubmitControl,
    isSubmitControl,
    advance,
    controlText,
  };
})();
