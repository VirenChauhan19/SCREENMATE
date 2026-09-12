/**
 * DOM → ApplicationState.
 *
 * This is the only genuinely new idea in the extension. The web app builds
 * ApplicationState from React state it owns; here we reconstruct the same shape
 * by reading a page we've never seen. Everything downstream — policy, agent,
 * tools, verification — is unchanged.
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

  function isVisible(el) {
    if (el.disabled || el.readOnly) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    // Zero-size elements are usually custom-widget plumbing, not real inputs.
    return rect.width > 1 && rect.height > 1;
  }

  function cleanText(s) {
    return (s || "").replace(/\s+/g, " ").trim();
  }

  /** Walks the usual accessibility affordances, then falls back to proximity. */
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
      const label = document.querySelector(`label[for="${escaped}"]`);
      const text = cleanText(label?.textContent);
      if (text) return text;
    }

    const wrapping = el.closest("label");
    if (wrapping) {
      const clone = wrapping.cloneNode(true);
      clone.querySelectorAll("input,select,textarea").forEach((n) => n.remove());
      const text = cleanText(clone.textContent);
      if (text) return text;
    }

    // Nearest preceding heading-ish or label-ish text within the field's group.
    const group = el.closest(
      "[class*=field], [class*=form-group], [class*=question], fieldset, li, div",
    );
    if (group) {
      const candidate = group.querySelector(
        "label, legend, .label, [class*=label], h1, h2, h3, h4, h5, h6",
      );
      const text = cleanText(candidate?.textContent);
      if (text && text.length < 220) return text;
    }

    return (
      cleanText(el.getAttribute("placeholder")) ||
      cleanText(el.getAttribute("name")) ||
      cleanText(el.id) ||
      "Untitled field"
    );
  }

  function isRequired(el, label) {
    if (el.required || el.getAttribute("aria-required") === "true") return true;
    if (/\*\s*$/.test(label)) return true;
    const group = el.closest("[class*=field], [class*=form-group], [class*=question]");
    return Boolean(group?.querySelector("[class*=required], .asterisk"));
  }

  /**
   * Maps an HTML control onto the vocabulary the agent already speaks.
   * Anything the policy layer doesn't recognize still gets a type, so a novel
   * widget degrades to "text" rather than being silently skipped.
   */
  function fieldType(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === "textarea") return "textarea";
    if (tag === "select") return "select";
    const t = (el.type || "text").toLowerCase();
    if (t === "email") return "email";
    if (t === "url") return "url";
    if (t === "radio") return "select";
    if (t === "checkbox") return "select";
    return "text";
  }

  function stableId(el, index) {
    const raw =
      el.getAttribute("name") ||
      el.id ||
      `${el.tagName.toLowerCase()}_${index}`;
    // Field ids travel through JSON and back into querySelector — keep them tame.
    return raw.replace(/[^\w.:\-\[\]]/g, "_").slice(0, 120);
  }

  function optionsFor(el) {
    if (el.tagName.toLowerCase() === "select") {
      return Array.from(el.options)
        .map((o) => cleanText(o.textContent))
        .filter((t) => t && !/^(select|choose|--)/i.test(t))
        .slice(0, 40);
    }
    if (el.type === "radio" && el.name) {
      const group = document.querySelectorAll(
        `input[type=radio][name="${CSS.escape(el.name)}"]`,
      );
      return Array.from(group)
        .map((r) => labelFor(r))
        .filter(Boolean)
        .slice(0, 40);
    }
    if (el.type === "checkbox") return ["Checked", "Unchecked"];
    return undefined;
  }

  function currentValue(el) {
    const t = (el.type || "").toLowerCase();
    if (t === "checkbox") return el.checked ? "Checked" : "Unchecked";
    if (t === "radio") {
      if (!el.name) return el.checked ? labelFor(el) : "";
      const checked = document.querySelector(
        `input[type=radio][name="${CSS.escape(el.name)}"]:checked`,
      );
      return checked ? labelFor(checked) : "";
    }
    if (el.tagName.toLowerCase() === "select") {
      const opt = el.selectedOptions?.[0];
      const text = cleanText(opt?.textContent);
      return /^(select|choose|--)/i.test(text || "") ? "" : text || "";
    }
    return el.value || "";
  }

  /** Collects form controls, collapsing radio groups to one logical field. */
  function collectElements() {
    const nodes = Array.from(
      document.querySelectorAll("input, select, textarea"),
    );
    const seenRadioGroups = new Set();
    const out = [];

    for (const el of nodes) {
      const type = (el.type || "").toLowerCase();
      if (SKIP_TYPES.has(type)) continue;
      if (!isVisible(el)) continue;

      const identity = `${el.name || ""} ${el.id || ""} ${el.getAttribute("autocomplete") || ""}`;
      if (SECRET_HINT.test(identity)) continue;

      if (type === "radio") {
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

    // The largest text block on the page is nearly always the posting body.
    let best = "";
    const candidates = document.querySelectorAll(
      "main, article, [class*=description], [class*=content], section",
    );
    for (const node of candidates) {
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
    };
  }

  function scanFields() {
    return collectElements().map((el, i) => {
      const label = labelFor(el);
      const type = fieldType(el);
      return {
        id: stableId(el, i),
        label: label.replace(/\s*\*\s*$/, "").slice(0, 300),
        type,
        required: isRequired(el, label),
        options: optionsFor(el),
        value: currentValue(el),
        el,
      };
    });
  }

  window.__screenmateScan = { scanFields, pageContext, labelFor, currentValue };
})();
