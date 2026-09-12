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
    "file",
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

  function labelFor(el) {
    const byAria = cleanText(el.getAttribute("aria-label"));
    if (byAria) return byAria;

    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => cleanText(document.getElementById(id)?.textContent))
        .filter(Boolean)
        .join(" ");
      if (text) return text;
    }

    if (el.id) {
      const escaped =
        window.CSS && CSS.escape ? CSS.escape(el.id) : el.id.replace(/"/g, '\\"');
      const text = cleanText(
        document.querySelector(`label[for="${escaped}"]`)?.textContent,
      );
      if (text) return text;
    }

    const wrapping = el.closest("label");
    if (wrapping) {
      const clone = wrapping.cloneNode(true);
      clone
        .querySelectorAll("input,select,textarea,button")
        .forEach((n) => n.remove());
      const text = cleanText(clone.textContent);
      if (text) return text;
    }

    // Workday wraps each question in a labelled group.
    const group = el.closest(
      "[data-automation-id*=formField], [class*=field], [class*=form-group], " +
        "[class*=question], [role=group], fieldset, li, div",
    );
    if (group) {
      const candidate = group.querySelector(
        "label, legend, [data-automation-id*=label], .label, [class*=label], " +
          "h1, h2, h3, h4, h5, h6",
      );
      const text = cleanText(candidate?.textContent);
      if (text && text.length < 220) return text;
    }

    return (
      cleanText(el.getAttribute("placeholder")) ||
      cleanText(automationId(el).replace(/[-_]/g, " ")) ||
      cleanText(el.getAttribute("name")) ||
      cleanText(el.id) ||
      "Untitled field"
    );
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
      );
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

  /** Best-effort page context so the agent knows what it is applying to. */
  function pageContext() {
    const meta = (sel, attr = "content") =>
      cleanText(document.querySelector(sel)?.getAttribute(attr));

    const company =
      meta('meta[property="og:site_name"]') ||
      cleanText(document.querySelector("header img[alt]")?.getAttribute("alt")) ||
      location.hostname.replace(/^www\./, "").split(".")[0];

    const jobTitle =
      cleanText(document.querySelector("h1")?.textContent) ||
      meta('meta[property="og:title"]') ||
      cleanText(document.title);

    let best = "";
    for (const node of document.querySelectorAll(
      "main, article, [class*=description], [class*=content], section",
    )) {
      if (node.querySelector("input, textarea, select")) continue;
      const text = cleanText(node.textContent);
      if (text.length > best.length) best = text;
    }
    if (best.length < 120) best = cleanText(document.body?.textContent).slice(0, 4000);

    return {
      company: (company || "this company").slice(0, 120),
      jobTitle: (jobTitle || "this role").slice(0, 160),
      jobDescription: best.slice(0, 4000),
      url: location.href,
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
      const label = labelFor(el);
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
    currentValue,
    pageSignature,
    deepQueryAll,
    cleanText,
    isVisible,
  };
})();
