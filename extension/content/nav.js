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

  /** "Next page" under a list of jobs moves through results, not an application. */
  const PAGINATION =
    "nav, [role=navigation], [class*=pagination], [class*=Pagination], [class*=pager], [aria-label*=pagination i], [aria-label*=pages i]";

  /**
   * True when the control sits with the form's own fields: in the same <form>,
   * or sharing a near container with one. A "Next" elsewhere on the page (a
   * carousel, a results list) is not this form's.
   */
  function belongsToForm(el, fields) {
    if (!fields?.length) return true;
    const els = fields.map((f) => f.el).filter((x) => x?.isConnected);
    if (!els.length) return true;
    const form = el.closest("form");
    if (form) return els.some((f) => form.contains(f));
    let node = el.parentElement;
    for (let d = 0; d < 10 && node && node !== document.body; d++, node = node.parentElement) {
      if (els.some((f) => node.contains(f))) return true;
    }
    return false;
  }

  /**
   * Finds the control that advances to the next step, or null.
   * Returns null rather than guessing: a wrong click here is unrecoverable.
   * `fields`, when given, are the step's fields: the control must belong
   * with them.
   */
  function findAdvanceControl({ fields } = {}) {
    const candidates = deepQueryAll(CLICKABLE).filter((el) => {
      if (!isVisible(el)) return false;
      if (el.disabled || el.getAttribute("aria-disabled") === "true") return false;
      if (el.closest(PAGINATION) || el.getAttribute("rel") === "next") return false;
      return true;
    });

    const scored = [];
    for (const el of candidates) {
      const text = controlText(el);
      if (!text || text.length > 60) continue;
      if (isSubmitControl(el)) continue;
      if (RETREAT_RE.test(text)) continue;
      if (!ADVANCE_RE.test(text)) continue;
      if (/\b(page|pages|results?|slide|photo|image|jobs?|openings?|roles?)\b/i.test(text)) continue;
      const hooked = /next|continue/i.test(el.getAttribute("data-automation-id") || "");
      if (!belongsToForm(el, fields)) continue;

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

  /**
   * The button that sends the application. Matched on what it positively says,
   * never on the refusal list above: that list also catches "Delete" and
   * "Withdraw", and the first of those on a page is not the thing to press.
   */
  const FINAL_SUBMIT_RE =
    /^(submit|submit (my |your |the )?application|submit app|apply|apply now|apply for (this )?(job|position|role)|send( my)? application|complete( my)? application|finish( (my )?application)?|submit and apply|review and submit|submit & apply)[\s.!→>›»]*$/i;
  /** Never the send button, whatever else its text says. */
  const NEVER_PRESS =
    /\b(delete|remove|withdraw|cancel|pay|purchase|sign out|log ?out|discard|clear|reset|back|previous|draft|later|upload|attach|linkedin|indeed|autofill|import)\b/i;

  /** On screen, whether or not it is enabled yet. */
  function onScreen(el) {
    if (el.getAttribute("aria-hidden") === "true") return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  }

  /**
   * Reports the page's send button, if it is showing one, and whether it is
   * enabled yet: a site that is still waiting on a field disables it.
   */
  function findSubmitControl({ fields } = {}) {
    const scored = [];
    for (const el of deepQueryAll(CLICKABLE)) {
      const text = controlText(el);
      if (!text || text.length > 60 || NEVER_PRESS.test(text) || !onScreen(el)) continue;
      if (!belongsToForm(el, fields)) continue;
      const hook = `${el.getAttribute("data-automation-id") || ""} ${el.getAttribute("data-qa") || ""} ${
        el.getAttribute("data-testid") || ""
      } ${el.id || ""}`;
      let score = 0;
      if (FINAL_SUBMIT_RE.test(text)) score += 5;
      else if (/\bsubmit\b/i.test(text) && /\bapplication\b/i.test(text)) score += 4;
      else continue;
      if ((el.type || "").toLowerCase() === "submit") score += 2;
      if (/submit/i.test(hook)) score += 2;
      if (el.closest("form")?.querySelector("input, textarea, select")) score += 2;
      scored.push({ el, text, score });
    }
    if (!scored.length) return null;
    scored.sort((a, b) => b.score - a.score);
    const { el, text } = scored[0];
    const disabled = el.disabled || el.getAttribute("aria-disabled") === "true";
    return { el, text, disabled };
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

  /** What a site says once it has taken an application. */
  const SUBMITTED =
    /thank(s| you) for (applying|your application)|application (has been |was )?(submitted|received|sent|complete)|we('ve| have) received your application|successfully (submitted|applied)|you('ve| have) (successfully )?applied/i;

  /** What the page itself has flagged as failing validation. */
  function pageErrors() {
    const invalid = deepQueryAll('[aria-invalid="true"]').filter(isVisible).length;
    const messages = [
      ...new Set(
        deepQueryAll("[role=alert], [class*=error], [class*=Error]")
          .filter((n) => isVisible(n))
          .map((n) => cleanText(n.textContent))
          .filter((t) => t.length > 3 && t.length < 160),
      ),
    ].slice(0, 4);
    return { invalid, messages };
  }

  /**
   * Presses the page's submit control, then reports what the site did.
   *
   * Called only from your explicit confirmation in the panel. The agent's own
   * navigation (`advance`) refuses every submit control and always will: a
   * submitted application cannot be taken back, so the decision is yours.
   */
  async function submitApplication({ timeout = 15000, fields } = {}) {
    const control = findSubmitControl({ fields });
    if (!control?.el?.isConnected) {
      return { ok: false, reason: "There is no submit button on this page." };
    }
    if (control.disabled) {
      return {
        ok: false,
        reason: `"${control.text}" is disabled: the site is still waiting on something, usually a required field or a file.`,
      };
    }
    const before = location.href;
    // A job page can say "thank you" before anything is sent; only new text counts.
    const saidBefore = SUBMITTED.test(document.body.innerText);
    control.el.scrollIntoView?.({ block: "center", behavior: "smooth" });
    await new Promise((r) => setTimeout(r, 250));
    control.el.click();

    const started = Date.now();
    while (Date.now() - started < timeout) {
      await new Promise((r) => setTimeout(r, 400));
      const text = document.body.innerText;
      if (!saidBefore && SUBMITTED.test(text)) {
        return { ok: true, detail: `The site says: "${cleanText(text.match(SUBMITTED)[0])}".` };
      }
    }
    const errors = pageErrors();
    if (errors.invalid || errors.messages.length) {
      return {
        ok: false,
        reason: `The site did not accept it yet${
          errors.messages.length
            ? `: ${errors.messages.join(" · ")}`
            : ` (${errors.invalid} field${errors.invalid === 1 ? "" : "s"} flagged)`
        }.`,
      };
    }
    return {
      ok: false,
      unknown: true,
      reason: "Submit was pressed, but the page has not confirmed it. Check the page before trying again.",
    };
  }

  window.__screenmateNav = {
    findAdvanceControl,
    findSubmitControl,
    isSubmitControl,
    advance,
    controlText,
    submitApplication,
    SUBMITTED,
  };
})();
