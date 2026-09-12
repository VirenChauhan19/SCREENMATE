/**
 * DOM → ApplicationState.
 *
 * The web app builds ApplicationState from React state it owns; here we
 * reconstruct the same shape by reading a page we've never seen. Everything
 * downstream — policy, agent, tools, verification — is unchanged.
 *
 * Real ATS forms are not plain HTML. Workday in particular renders selects as
 * button + listbox widgets identified by `data-automation-id`, so this walks
 * ARIA roles and open shadow roots as well as native form controls.
 */

(() => {
  const SKIP_TYPES = new Set([
    "hidden",
    "submit",
    "button",
    "reset",
    "image",
    "password",
  ]);

  /** Inputs whose contents we must never read or transmit. */
  const SECRET_HINT =
    /password|passwd|ssn|social.?security|credit.?card|card.?number|cvv|cvc|routing|account.?number|api.?key|token|secret/i;

  /** Walks open shadow roots, which native querySelectorAll will not enter. */
  function deepQueryAll(selector, root = document, out = [], depth = 0) {
    if (depth > 12) return out;
    try {
      out.push(...root.querySelectorAll(selector));
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) deepQueryAll(selector, el.shadowRoot, out, depth + 1);
      }
    } catch {
      /* a detached or hostile root should never break the scan */
    }
    return out;
  }

  function isVisible(el) {
    if (el.disabled || el.readOnly) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    if (el.getAttribute("aria-disabled") === "true") return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  }

  const cleanText = (s) => (s || "").replace(/\s+/g, " ").trim();

  /** Workday and friends hang stable hooks off data-automation-id. */
  const automationId = (el) =>
    el.getAttribute?.("data-automation-id") ||
    el.getAttribute?.("data-testid") ||
    el.getAttribute?.("data-qa") ||
    "";

  /** Text that decorates a label rather than naming it. */
  const NOISE = [
    /no location found[\s\S]*$/i,
    /try entering a different/i,
    /\(optional\)\s*$/i,
    /this field is required[\s\S]*$/i,
    /please enter[\s\S]*$/i,
    /must be a valid[\s\S]*$/i,
  ];

  /**
   * Reads an element's label text without the scaffolding around it.
   *
   * Real forms hang required markers and validation messages inside the same
   * node as the label — Lever renders `<span class="required">✱</span>` inline,
   * so a naive textContent yields "Full name✱" or, worse, "Current location ✱No
   * location found. Try entering a different…". Both break topic matching, and a
   * mangled label is how a sensitive question gets classified safe.
   */
  /** Strips decoration from an already-extracted string. */
  function tidyLabel(raw) {
    let text = cleanText(raw);
    for (const re of NOISE) text = text.replace(re, "");
    return text
      .replace(/[*✱✽★†‡]+/g, " ")
      .replace(/\s{2,}/g, " ")
      .replace(/[\s:·|-]+$/, "")
      .trim();
  }

  function labelText(node) {
    if (!node) return "";
    const clone = node.cloneNode(true);
    clone
      .querySelectorAll(
        "input, select, textarea, button, " +
          "[class*=required], [class*=Required], abbr, " +
          "[class*=error], [class*=Error], [class*=hint], [class*=help], " +
          "[role=alert], [aria-live], [class*=field], [class*=Field]",
      )
      .forEach((n) => n.remove());

    return tidyLabel(clone.textContent);
  }

  const LABEL_SELECTOR =
    "label, legend, [data-automation-id*=label], .label, [class*=label], " +
    "[class*=Label], [class*=question-text], h1, h2, h3, h4, h5, h6";

  /** True when this node names a field rather than being part of one. */
  function isLabelCandidate(node, el) {
    if (!node || node.contains(el)) return false;
    if (node.querySelector("input, select, textarea")) return false;
    const t = labelText(node);
    return Boolean(t) && t.length > 1 && t.length < 220;
  }

  function labelFor(el) {
    const byAria = tidyLabel(el.getAttribute("aria-label"));
    if (byAria) return byAria;

    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => labelText(document.getElementById(id)))
        .filter(Boolean)
        .join(" ");
      if (text) return text;
    }

    if (el.id) {
      const escaped =
        window.CSS && CSS.escape ? CSS.escape(el.id) : el.id.replace(/"/g, '\\"');
      const text = labelText(document.querySelector(`label[for="${escaped}"]`));
      if (text) return text;
    }

    const wrapping = el.closest("label");
    if (wrapping) {
      // Prefer the inner label node, which excludes the field and its errors.
      const inner = [...wrapping.querySelectorAll("[class*=label], [class*=Label]")]
        .find((n) => isLabelCandidate(n, el));
      const text = inner ? labelText(inner) : labelText(wrapping);
      if (text) return text;
    }

    // Walk up. closest() stops at the first container that matches, which on a
    // real form is often the inner field wrapper with no label inside it.
    let node = el.parentElement;
    for (let depth = 0; depth < 8 && node; depth++, node = node.parentElement) {
      const candidate = [...node.querySelectorAll(LABEL_SELECTOR)].find((n) =>
        isLabelCandidate(n, el),
      );
      if (candidate) return labelText(candidate);
      if (node.tagName === "FORM" || node.tagName === "BODY") break;
    }

    return (
      cleanText(el.getAttribute("placeholder")) ||
      cleanText(automationId(el).replace(/[-_]/g, " ")) ||
      cleanText(el.getAttribute("name")) ||
      cleanText(el.id) ||
      "Untitled field"
    );
  }

  /**
   * The question a grouped control belongs to.
   *
   * A radio wrapped in `<label>Yes</label>` answers "Yes" — but the field is
   * "Will you require visa sponsorship?". Reading the option's own label here
   * is not just cosmetic: it is how a sensitive question gets classified safe.
   */
  function groupLabelFor(el) {
    const byAria = tidyLabel(el.getAttribute("aria-label"));
    if (byAria) return byAria;

    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => labelText(document.getElementById(id)))
        .filter(Boolean)
        .join(" ");
      if (text) return text;
    }

    const name = el.getAttribute("name");
    let node = el.parentElement;
    for (let depth = 0; depth < 7 && node; depth++, node = node.parentElement) {
      const siblings = name
        ? node.querySelectorAll(`input[name="${CSS.escape(name)}"]`).length
        : 0;
      const isWrapper = node.matches?.(
        "fieldset, [role=group], [role=radiogroup], [class*=question], " +
          "[class*=field], [data-automation-id*=formField]",
      );
      if (siblings < 2 && !isWrapper) continue;

      const candidate = [...node.querySelectorAll(LABEL_SELECTOR)].find((n) =>
        isLabelCandidate(n, el),
      );
      if (candidate) return labelText(candidate);
    }
    return labelFor(el);
  }

  function isRequired(el, label) {
    if (el.required || el.getAttribute("aria-required") === "true") return true;
    if (/\*\s*$/.test(label)) return true;
    const group = el.closest(
      "[data-automation-id*=formField], [class*=field], [class*=form-group], [class*=question]",
    );
    return Boolean(
      group?.querySelector("[class*=required], .asterisk, abbr[title=required]"),
    );
  }

  /**
   * Maps a control onto the vocabulary the agent already speaks. A widget we
   * don't recognise degrades to "text" rather than being skipped silently.
   */
  function fieldType(el) {
    const tag = el.tagName.toLowerCase();
    const role = (el.getAttribute("role") || "").toLowerCase();

    if (tag === "textarea") return "textarea";
    if (tag === "select") return "select";
    // Surfaced, never filled: a resume has to come from the user's machine.
    if ((el.type || "").toLowerCase() === "file") return "file";
    if (role === "combobox" || role === "listbox") return "select";
    if (role === "radiogroup") return "select";
    if (role === "checkbox" || role === "switch") return "select";
    if (el.isContentEditable) return "textarea";
    if (role === "textbox") {
      return el.getAttribute("aria-multiline") === "true" ? "textarea" : "text";
    }

    const t = (el.type || "text").toLowerCase();
    if (t === "email") return "email";
    if (t === "url") return "url";
    if (t === "radio" || t === "checkbox") return "select";
    return "text";
  }

  function stableId(el, index) {
    const raw =
      automationId(el) ||
      el.getAttribute("name") ||
      el.id ||
      `${el.tagName.toLowerCase()}_${index}`;
    return raw.replace(/[^\w.:\-[\]]/g, "_").slice(0, 120);
  }

  /** Options for a native select, a radio group, or an ARIA listbox widget. */
  function optionsFor(el) {
    const tag = el.tagName.toLowerCase();
    const role = (el.getAttribute("role") || "").toLowerCase();

    if (tag === "select") {
      return Array.from(el.options)
        .map((o) => cleanText(o.textContent))
        .filter((t) => t && !/^(select|choose|--)/i.test(t))
        .slice(0, 60);
    }

    if (el.type === "radio" && el.name) {
      return Array.from(
        document.querySelectorAll(
          `input[type=radio][name="${CSS.escape(el.name)}"]`,
        ),
      )
        .map((r) => labelFor(r))
        .filter(Boolean)
        .slice(0, 60);
    }

    if (role === "radiogroup") {
      return Array.from(el.querySelectorAll("[role=radio]"))
        .map((r) => cleanText(r.getAttribute("aria-label") || r.textContent))
        .filter(Boolean)
        .slice(0, 60);
    }

    if (el.type === "checkbox" || role === "checkbox" || role === "switch") {
      return ["Checked", "Unchecked"];
    }

    // ARIA combobox: options usually live in a popup referenced by id, and only
    // exist in the DOM once opened. Read them if present, otherwise leave empty
    // and let the writer discover them when it opens the control.
    if (role === "combobox" || role === "listbox") {
      const owned =
        el.getAttribute("aria-controls") || el.getAttribute("aria-owns") || "";
      const popup = owned
        ? document.getElementById(owned.split(/\s+/)[0])
        : el.querySelector("[role=listbox]");
      if (popup) {
        return Array.from(popup.querySelectorAll("[role=option]"))
          .map((o) => cleanText(o.getAttribute("aria-label") || o.textContent))
          .filter(Boolean)
          .slice(0, 60);
      }
    }

    return undefined;
  }

  function currentValue(el) {
    // Never read a file path off the user's machine.
    if ((el.type || "").toLowerCase() === "file") {
      return el.files?.length ? `${el.files.length} file selected` : "";
    }
    const tag = el.tagName.toLowerCase();
    const role = (el.getAttribute("role") || "").toLowerCase();
    const t = (el.type || "").toLowerCase();

    if (t === "checkbox") return el.checked ? "Checked" : "Unchecked";
    if (role === "checkbox" || role === "switch") {
      return el.getAttribute("aria-checked") === "true" ? "Checked" : "Unchecked";
    }
    if (t === "radio") {
      if (!el.name) return el.checked ? labelFor(el) : "";
      const checked = document.querySelector(
        `input[type=radio][name="${CSS.escape(el.name)}"]:checked`,
      );
      return checked ? labelFor(checked) : "";
    }
    if (role === "radiogroup") {
      const checked = el.querySelector('[role=radio][aria-checked="true"]');
      return checked
        ? cleanText(checked.getAttribute("aria-label") || checked.textContent)
        : "";
    }
    if (tag === "select") {
      const text = cleanText(el.selectedOptions?.[0]?.textContent);
      return /^(select|choose|--)/i.test(text || "") ? "" : text || "";
    }
    if (role === "combobox" || role === "listbox") {
      // Workday renders the chosen value as the button's own text.
      const raw = cleanText(
        el.value || el.getAttribute("aria-valuetext") || el.textContent,
      )
        // Custom controls fold their chevron into textContent.
        .replace(/[▾▴▼▲⌄⌃˅˄]+\s*$/, "")
        .trim();
      return /^(select one|select|choose|--)/i.test(raw) ? "" : raw;
    }
    if (el.isContentEditable) return cleanText(el.textContent);
    return el.value || "";
  }

  const WIDGET_SELECTOR = [
    "input",
    "select",
    "textarea",
    "[role=textbox]",
    "[role=combobox]",
    "[role=listbox]",
    "[role=radiogroup]",
    "[role=checkbox]",
    "[role=switch]",
    "[contenteditable=true]",
  ].join(",");

  /** Collects controls, collapsing radio groups to one logical field. */
  function collectElements() {
    const nodes = deepQueryAll(WIDGET_SELECTOR);
    const seenRadioGroups = new Set();
    const seen = new Set();
    const out = [];

    for (const el of nodes) {
      if (seen.has(el)) continue;
      seen.add(el);

      // `.type` is only meaningful on <input>. A <button role="combobox"> — the
      // standard Workday dropdown — reports type "submit" and would otherwise be
      // skipped as a submit control.
      const isInput = el.tagName.toLowerCase() === "input";
      if (isInput && SKIP_TYPES.has((el.type || "text").toLowerCase())) continue;
      if (!isVisible(el)) continue;

      const identity = `${el.name || ""} ${el.id || ""} ${automationId(el)} ${
        el.getAttribute("autocomplete") || ""
      }`;
      if (SECRET_HINT.test(identity)) continue;

      // A radiogroup wrapper supersedes its individual radios.
      if (el.closest("[role=radiogroup]") && el.getAttribute("role") !== "radiogroup") {
        continue;
      }
      if (isInput && el.type === "radio") {
        const key = el.name || el.id;
        if (seenRadioGroups.has(key)) continue;
        seenRadioGroups.add(key);
      }
      out.push(el);
    }
    return out;
  }

  /**
   * Best-effort page context so the agent knows what it is applying to.
   *
   * Embedded forms (Taleo, iCIMS, embedded Greenhouse) sit in an iframe that
   * knows nothing about the job — the posting is in the parent document.
   */
  function pageContext() {
    const host = (() => {
      try {
        if (window !== window.top && window.top.document?.body) return window.top;
      } catch {
        /* cross-origin parent: fall back to our own document */
      }
      return window;
    })();
    const doc = host.document;

    const meta = (sel, attr = "content") =>
      cleanText(doc.querySelector(sel)?.getAttribute(attr));

    const company =
      meta('meta[property="og:site_name"]') ||
      cleanText(doc.querySelector("header img[alt]")?.getAttribute("alt")) ||
      host.location.hostname.replace(/^www\./, "").split(".")[0];

    const jobTitle =
      cleanText(doc.querySelector("h1")?.textContent) ||
      meta('meta[property="og:title"]') ||
      cleanText(doc.title);

    let best = "";
    for (const node of doc.querySelectorAll(
      "main, article, [class*=description], [class*=content], section",
    )) {
      if (node.querySelector("input, textarea, select")) continue;
      const text = cleanText(node.textContent);
      if (text.length > best.length) best = text;
    }
    if (best.length < 120) best = cleanText(doc.body?.textContent).slice(0, 4000);

    return {
      company: (company || "this company").slice(0, 120),
      jobTitle: (jobTitle || "this role").slice(0, 160),
      jobDescription: best.slice(0, 4000),
      url: host.location.href,
      stepLabel: currentStepLabel(),
    };
  }

  /** Reads the wizard's own progress indicator, when it exposes one. */
  function currentStepLabel() {
    const current = document.querySelector(
      '[aria-current="step"], [data-automation-id*=progressBar] [aria-current], ' +
        "[class*=step][class*=active], [class*=progress] [aria-current]",
    );
    const text = cleanText(current?.textContent);
    if (text && text.length < 60) return text;

    const heading = cleanText(
      document.querySelector("h1, h2, [role=heading]")?.textContent,
    );
    return heading && heading.length < 60 ? heading : "";
  }

  function scanFields() {
    return collectElements().map((el, i) => {
      const type = (el.type || "").toLowerCase();
      const grouped =
        type === "radio" ||
        type === "checkbox" ||
        (el.getAttribute("role") || "").toLowerCase() === "radiogroup";
      const label = grouped ? groupLabelFor(el) : labelFor(el);
      return {
        id: stableId(el, i),
        label: label.replace(/\s*\*\s*$/, "").slice(0, 300),
        type: fieldType(el),
        required: isRequired(el, label),
        options: optionsFor(el),
        value: currentValue(el),
        el,
      };
    });
  }

  /** A cheap fingerprint used to tell "the page changed" from "it didn't". */
  function pageSignature() {
    const ids = collectElements()
      .map((el, i) => stableId(el, i))
      .sort()
      .join("|");
    return `${location.href}::${currentStepLabel()}::${ids}`;
  }

  window.__screenmateScan = {
    scanFields,
    pageContext,
    labelFor,
    groupLabelFor,
    currentValue,
    pageSignature,
    deepQueryAll,
    cleanText,
    isVisible,
  };
})();
