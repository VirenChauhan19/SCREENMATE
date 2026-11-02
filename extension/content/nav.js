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
    /\b(submit|apply|send application|finish|complete application|confirm and|agree and|i agree|accept and|sign and|pay|purchase|delete|withdraw)\b/i;

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

  const FORM = 'form, [role=form]';
  const DIALOG = 'dialog, [role=dialog], [role=alertdialog]';
  const WIDGET = '[role=menu], [role=listbox], [role=tablist], [aria-roledescription=carousel], [class*=carousel], [id*=carousel]';
  const LANDMARK = 'header, nav, [role=navigation], [role=banner], [role=search]';

  const formFor = el => el?.form || el?.closest?.(FORM) || null;

  /** Only one application form/dialog may authorize a navigation control. */
  function navigationScope() {
    // The scanner also reports styled file inputs through their visible upload
    // UI. Keep that ownership on upload-only steps even when the input is hidden.
    const fields = window.__screenmateScan.scanFields()
      .filter(field => field.el?.isConnected && (field.type === 'file' || isVisible(field.el)) &&
        !field.el.closest?.(`${LANDMARK}, ${WIDGET}`)).map(field => field.el);
    const forms = new Set(fields.map(formFor).filter(Boolean));
    const dialogs = new Set(fields.map(el => el.closest?.(DIALOG)).filter(Boolean));
    if (forms.size > 1 || dialogs.size > 1) return { ambiguous: true };
    const form = [...forms][0] || null;
    const dialog = [...dialogs][0] || null;
    if (form && dialog && !dialog.contains(form)) return { ambiguous: true };
    if (dialog && fields.some(el => !dialog.contains(el) && !(form && formFor(el) === form))) return { ambiguous: true };
    return { form, dialog };
  }

  function inNavigationScope(el, scope = navigationScope()) {
    if (scope.ambiguous || el.closest?.(WIDGET)) return false;
    const form = formFor(el);
    const dialog = el.closest?.(DIALOG) || null;
    // A popup unrelated to the application's dialog must not take over Next.
    if (dialog && dialog !== scope.dialog) return false;
    if (scope.form) {
      if (form && form !== scope.form) return false;
      // HTML allows a footer button outside <form> with form="application".
      return form === scope.form || scope.form.contains(el) || Boolean(scope.dialog?.contains(el));
    }
    if (scope.dialog) return scope.dialog.contains(el);
    // Form-less wizards (including Workday) retain their page controls, but
    // navigation bars, carousel controls and unrelated forms stay excluded.
    return !form && !dialog && !el.closest?.(LANDMARK);
  }

  function available(el) {
    return el?.isConnected && isVisible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true';
  }

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
    const scope = navigationScope();
    const candidates = deepQueryAll(CLICKABLE).filter(el => available(el) && inNavigationScope(el, scope));

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

  /** A refused ambiguous Next is a review task, not proof of the final step. */
  function navigationProblem() {
    if (!navigationScope().ambiguous) return null;
    const hasForwardControl = deepQueryAll(CLICKABLE).some(el => {
      if (!el.isConnected || !isVisible(el) || el.closest?.(`${LANDMARK}, ${WIDGET}`)) return false;
      const text = controlText(el);
      return text.length <= 60 && ADVANCE_RE.test(text) && !RETREAT_RE.test(text) && !isSubmitControl(el);
    });
    return hasForwardControl
      ? 'Multiple forms or dialogs are visible, so SCREENMATE could not identify the application’s next step. Choose the correct Next or Continue on the application form, then run SCREENMATE again.'
      : null;
  }

  /** Reports the submit control, if the page is showing one, for the handoff. */
  function findSubmitControl() {
    const scope = navigationScope();
    const el = deepQueryAll(CLICKABLE).find(
      (n) => isVisible(n) && inNavigationScope(n, scope) && isSubmitControl(n) && controlText(n).length < 60,
    );
    return el ? { el, text: controlText(el) } : null;
  }

  /**
   * Clicks `control` and waits for the page to actually become a different page.
   * Resolves with the outcome rather than throwing, so the loop can report and
   * stop cleanly when a wizard refuses to advance (usually a validation error).
   */
  async function advance(control, { timeout = 15000, cancelled = () => false } = {}) {
    if (cancelled()) return { ok: false, reason: 'You moved on; rescanning' };
    if (!control?.el?.isConnected) {
      return { ok: false, reason: "Advance control disappeared" };
    }
    if (isSubmitControl(control.el)) {
      // Belt and braces: findAdvanceControl already excluded these.
      return { ok: false, reason: "Refusing to click a submit control" };
    }
    if (!available(control.el) || !inNavigationScope(control.el) || !ADVANCE_RE.test(controlText(control.el)) || RETREAT_RE.test(controlText(control.el))) {
      return { ok: false, reason: 'Advance control is no longer available' };
    }

    const before = window.__screenmateScan.pageSignature();
    control.el.scrollIntoView?.({ block: "center", behavior: "smooth" });
    await new Promise((r) => setTimeout(r, 250));
    if (cancelled()) return { ok: false, reason: 'You moved on; rescanning' };
    if (!available(control.el) || !inNavigationScope(control.el) || isSubmitControl(control.el) ||
      !ADVANCE_RE.test(controlText(control.el)) || RETREAT_RE.test(controlText(control.el))) {
      return { ok: false, reason: 'Advance control changed before the click' };
    }
    control.el.click();

    const started = Date.now();
    let settledFor = 0;
    let last = before;

    while (Date.now() - started < timeout) {
      await new Promise((r) => setTimeout(r, 350));
      if (cancelled()) return { ok: false, reason: 'You moved on; rescanning' };
      const now = window.__screenmateScan.pageSignature();

      if (now !== before) {
        // Changed — now wait for it to stop changing before we scan.
        settledFor = now === last ? settledFor + 350 : 0;
        last = now;
        if (settledFor >= 700 && window.__screenmateScan.scanFields().length > 0) return { ok: true };
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
    navigationProblem,
    findSubmitControl,
    isSubmitControl,
    advance,
    controlText,
  };
})();
