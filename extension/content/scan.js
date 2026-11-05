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
    if (el.closest?.('[hidden], [inert], [aria-hidden="true"], [aria-disabled="true"]')) return false;
    const host = el.getRootNode()?.host;
    if (host && !isVisible(host)) return false;
    // :disabled includes inherited fieldset disabling and preserves the first
    // legend exception; the element's .disabled property alone does neither.
    if (el.disabled || el.matches?.(':disabled') || el.readOnly) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    if (el.getAttribute("aria-disabled") === "true") return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  }

  /** A styled upload can hide its native input while leaving a real picker UI. */
  function hasVisibleUploadControl(el) {
    if (el.tagName !== 'INPUT' || el.type !== 'file' || el.disabled ||
      el.matches?.(':disabled') || el.closest?.('[inert], [aria-disabled="true"]')) return false;
    // Only the native input may be hidden for styling. A hidden/inert section
    // must not become a required task just because a label exists elsewhere.
    for (let node = el.parentElement || el.getRootNode()?.host; node;
      node = node.parentElement || node.getRootNode()?.host) {
      if (node.hidden || node.inert || node.getAttribute?.('aria-hidden') === 'true' ||
        node.getAttribute?.('aria-disabled') === 'true') return false;
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || Number(style.opacity) === 0) return false;
    }
    if (Array.from(el.labels || []).some(isVisible)) return true;
    const wrappingLabel = el.closest('label');
    if (wrappingLabel && isVisible(wrappingLabel)) return true;

    // Unlabelled upload inputs are sometimes paired with a button in one field
    // group. Require a single control and visible upload UI, never the form.
    const group = el.closest('[role=group], [class*=upload], [class*=Upload], [class*=field], [class*=Field], [data-automation-id*=formField]');
    if (!group || ['FORM', 'BODY'].includes(group.tagName) || !isVisible(group)) return false;
    const controls = Array.from(group.querySelectorAll('input:not([type=hidden]), select, textarea, [role=combobox]'));
    if (controls.length !== 1 || controls[0] !== el) return false;
    return /upload|attach|r[eé]sum[eé]|curriculum vitae|\bcv\b|cover letter|document|file/i.test(group.textContent || '') &&
      Array.from(group.querySelectorAll('button, [role=button], label, legend')).some(isVisible);
  }

  const cleanText = (s) => (s || "").replace(/\s+/g, " ").trim();

  // IDs and radio names are scoped to a tree/form, not the entire page.
  function referencedElement(el, id) {
    return el.getRootNode()?.getElementById?.(id) || el.ownerDocument.getElementById(id);
  }

  /** Read only explicit help for this question, never surrounding form text. */
  function instructionsFor(el) {
    const descriptions = [cleanText(el.getAttribute('aria-description'))];
    const ids = new Set((el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
    for (const id of ids) {
      const node = referencedElement(el, id);
      // Validation alerts and live character counters are state, not writing
      // instructions. Their changing text must not restart a draft in flight.
      if (!node || !isVisible(node) || node.closest?.('[role=alert], [role=status], [aria-live]')) continue;
      descriptions.push(cleanText(node.textContent));
    }
    return [...new Set(descriptions.filter(Boolean))].join(' ').slice(0, 1000) || undefined;
  }

  function radioMembers(el) {
    if (!el.name) return [el];
    return Array.from(el.getRootNode().querySelectorAll('input[type=radio]'))
      .filter((r) => r.name === el.name && r.form === el.form);
  }

  function isPlaceholderOption(option) {
    const text = cleanText(option?.textContent);
    return !option || !text || option.disabled || option.parentElement?.disabled ||
      /^(select(?: one| an? .+)?|choose(?: one| an? .+)?|please select.*|--+)\s*[.…:]*$/i.test(text);
  }

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
        .map((id) => labelText(referencedElement(el, id)))
        .filter(Boolean)
        .join(" ");
      if (text) return text;
    }

    if (el.id) {
      const escaped =
        window.CSS && CSS.escape ? CSS.escape(el.id) : el.id.replace(/"/g, '\\"');
      const text = labelText(el.getRootNode().querySelector(`label[for="${escaped}"]`));
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
        .map((id) => labelText(referencedElement(el, id)))
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
    if (el.type === 'radio' && radioMembers(el).some(member => member.required || member.getAttribute('aria-required') === 'true')) return true;
    const labelled = (el.getAttribute('aria-labelledby') || '').split(/\s+/)
      .map((id) => referencedElement(el, id));
    if (Array.from(el.labels || []).concat(labelled).some((n) => /[*✱✽]/.test(n?.textContent || ''))) return true;
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
      el.id ||
      el.getAttribute("name") ||
      automationId(el) ||
      `${el.tagName.toLowerCase()}_${index}`;
    return raw.replace(/[^\w.:\-[\]]/g, "_").slice(0, 120);
  }

  /** Options for a native select, a radio group, or an ARIA listbox widget. */
  function optionsFor(el) {
    const tag = el.tagName.toLowerCase();
    const role = (el.getAttribute("role") || "").toLowerCase();

    if (tag === "select") {
      return Array.from(el.options)
        .filter((o) => !isPlaceholderOption(o))
        .map((o) => cleanText(o.textContent))
        .slice(0, 300);
    }

    if (el.type === "radio" && el.name) {
      return radioMembers(el)
        .filter(isVisible)
        .map((r) => labelFor(r))
        .filter(Boolean)
        .slice(0, 300);
    }

    if (role === "radiogroup") {
      return Array.from(el.querySelectorAll("[role=radio]"))
        .filter(isVisible)
        .map((r) => cleanText(r.getAttribute("aria-label") || r.textContent))
        .filter(Boolean)
        .slice(0, 300);
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
        ? referencedElement(el, owned.split(/\s+/)[0])
        : el.querySelector("[role=listbox]");
      if (popup) {
        return Array.from(popup.querySelectorAll("[role=option]"))
          .map((o) => cleanText(o.getAttribute("aria-label") || o.textContent))
          .filter(Boolean)
          .slice(0, 300);
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

    if (t === "checkbox") return el.checked ? "Checked" : (isRequired(el, labelFor(el)) ? "" : "Unchecked");
    if (role === "checkbox" || role === "switch") {
      return el.getAttribute("aria-checked") === "true" ? "Checked" : (isRequired(el, labelFor(el)) ? "" : "Unchecked");
    }
    if (t === "radio") {
      if (!el.name) return el.checked ? labelFor(el) : "";
      const checked = radioMembers(el).find((r) => r.checked && isVisible(r));
      return checked ? labelFor(checked) : "";
    }
    if (role === "radiogroup") {
      const checked = Array.from(el.querySelectorAll('[role=radio][aria-checked="true"]')).find(isVisible);
      return checked
        ? cleanText(checked.getAttribute("aria-label") || checked.textContent)
        : "";
    }
    if (tag === "select") {
      const selected = el.selectedOptions?.[0];
      return isPlaceholderOption(selected) ? "" : cleanText(selected.textContent);
    }
    if (role === "combobox" || role === "listbox") {
      // Workday renders the chosen value as the button's own text.
      // react-select clears its search input after rendering a sibling value.
      if (tag === "input") {
        let container = el.parentElement;
        for (let depth = 0; container && depth < 4; depth++, container = container.parentElement) {
          if (container.querySelectorAll('[role="combobox"]').length > 1) break;
          const selected = container.querySelector('[class*="singleValue"], [class*="single-value"]');
          if (selected && cleanText(selected.textContent)) return cleanText(selected.textContent);
        }
      }
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
      if (!isVisible(el) && !hasVisibleUploadControl(el)) continue;
      // The panel and popup menus are UI, not application questions.
      if (el.getRootNode()?.host?.id === 'screenmate-root') continue;
      // A search box inside a combobox popup is part of the widget, not a new
      // application question. Including it cancels our own option discovery.
      const popupAncestor = el.closest('[role=listbox], [role=menu]');
      if (popupAncestor && popupAncestor !== el && deepQueryAll('[role=combobox]').some((control) =>
        (control.getAttribute('aria-controls') || control.getAttribute('aria-owns') || '').split(/\s+/)
          .some((id) => referencedElement(control, id) === popupAncestor))) continue;
      if (el.getAttribute('role') === 'listbox' && deepQueryAll('[role=combobox]').some((c) =>
        (c.getAttribute('aria-controls') || c.getAttribute('aria-owns') || '').split(/\s+/).some((id) => referencedElement(c, id) === el))) continue;

      const identity = `${el.name || ""} ${el.id || ""} ${automationId(el)} ${
        el.getAttribute("autocomplete") || ""
      }`;
      if (SECRET_HINT.test(identity)) continue;

      // A radiogroup wrapper supersedes its individual radios.
      if (el.closest("[role=radiogroup]") && el.getAttribute("role") !== "radiogroup") {
        continue;
      }
      if (isInput && el.type === "radio") {
        const key = radioMembers(el)[0];
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
  function structuredJob(doc, pageUrl) {
    const postings = [];
    function visit(value, depth = 0) {
      if (!value || depth > 6 || postings.length > 100) return;
      if (Array.isArray(value)) { value.slice(0, 100).forEach(item => visit(item, depth + 1)); return; }
      if (typeof value !== 'object') return;
      const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
      if (types.some(type => typeof type === 'string' && /(?:^|\/)JobPosting$/.test(type))) postings.push(value);
      for (const key of ['@graph', 'mainEntity', 'itemListElement', 'item']) visit(value[key], depth + 1);
    }
    for (const script of [...doc.querySelectorAll('script[type="application/ld+json"]')].slice(0, 12)) {
      if (!script.textContent || script.textContent.length > 300000) continue;
      try { visit(JSON.parse(script.textContent)); } catch { /* Invalid page metadata is optional. */ }
    }
    const normalizeUrl = value => {
      if (typeof value !== 'string') return null;
      try {
        const url = new URL(value, pageUrl);
        return `${url.origin}${url.pathname.replace(/\/$/, '')}${url.search}`;
      } catch { return null; }
    };
    const page = normalizeUrl(pageUrl);
    const matches = postings.filter(post => [post.url, post['@id'],
      typeof post.mainEntityOfPage === 'object' ? post.mainEntityOfPage?.['@id'] : post.mainEntityOfPage]
      .some(url => page && normalizeUrl(url) === page));
    const posting = matches.length === 1 ? matches[0] : postings.length === 1 ? postings[0] : null;
    if (!posting) return null;
    const text = value => typeof value === 'string' ? cleanText(value.replace(/<[^>]*>/g, ' '))
      .replace(/&(amp|quot|apos|lt|gt|nbsp);/g, (_, entity) => ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' })[entity]) : '';
    return { title: text(posting.title), company: text(posting.hiringOrganization?.name), description: text(posting.description) };
  }

  function documentContext(host) {
    const doc = host.document;
    const job = structuredJob(doc, host.location.href);

    const meta = (sel, attr = "content") =>
      cleanText(doc.querySelector(sel)?.getAttribute(attr));

    const company =
      job?.company ||
      meta('meta[property="og:site_name"]') ||
      cleanText(doc.querySelector("header img[alt]")?.getAttribute("alt")) ||
      host.location.hostname.replace(/^www\./, "").split(".")[0];

    const jobTitle =
      job?.title ||
      cleanText(doc.querySelector("h1")?.textContent) ||
      meta('meta[property="og:title"]') ||
      cleanText(doc.title);

    let best = job?.description || "";
    for (const node of best ? [] : doc.querySelectorAll(
      "main, article, [class*=description], [class*=content], section",
    )) {
      if (node.querySelector("input, textarea, select")) continue;
      const text = cleanText(node.textContent);
      if (text.length > best.length) best = text;
    }
    if (!job?.description && best.length < 120) best = cleanText(doc.body?.textContent).slice(0, 4000);

    return {
      company: (company || "this company").slice(0, 120),
      jobTitle: (jobTitle || "this role").slice(0, 160),
      jobDescription: best.slice(0, 4000),
      url: host.location.href.slice(0, 2048),
      hasStructuredJob: Boolean(job?.title && job?.company),
    };
  }

  let parentContext = null;
  let parentContextFrameUrl = '';
  function boundedContext(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const context = {};
    for (const [key, limit] of Object.entries({ company: 120, jobTitle: 160, jobDescription: 4000, url: 2048 })) {
      if (typeof raw[key] !== 'string' || raw[key].length > limit) return null;
      context[key] = cleanText(raw[key]);
    }
    try { if (!['http:', 'https:'].includes(new URL(context.url).protocol)) return null; } catch { return null; }
    if (typeof raw.hasStructuredJob !== 'boolean') return null;
    context.hasStructuredJob = raw.hasStructuredJob;
    return context;
  }

  function setParentContext(raw) {
    if (raw === null) { parentContext = null; parentContextFrameUrl = ''; return true; }
    const context = boundedContext(raw);
    if (!context) return false;
    parentContext = context;
    parentContextFrameUrl = window.location.href;
    return true;
  }

  function contextForMessage() {
    return boundedContext(documentContext(window));
  }

  function contextScore(context) {
    const genericTitle = /^(?:this role|application|apply(?: now)?|careers?|jobs?|job application|application form|job board)(?:\s*[|:-].*)?$/i;
    const titleScore = genericTitle.test(context.jobTitle) ? 0 : 4;
    return titleScore + Math.min(context.jobDescription.length / 400, 3) +
      (/^(?:this company|greenhouse|lever|workday|icims|taleo|job board)(?:\s|$)/i.test(context.company) ? 0 : 1);
  }

  function pageContext() {
    const own = documentContext(window);
    let parent = parentContextFrameUrl === window.location.href ? parentContext : null;
    if (window !== window.top) {
      try { if (window.top.document?.body) parent = documentContext(window.top); } catch { /* Use the bounded parent handoff. */ }
    }
    // A posting in the active form frame names its own role. A generic ATS
    // shell instead benefits from the employer's enclosing posting.
    const selected = !parent || own.hasStructuredJob ? own : parent.hasStructuredJob || contextScore(parent) > contextScore(own) ? parent : own;
    return { ...selected, stepLabel: currentStepLabel() };
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
    const elements = collectElements();
    const bases = elements.map(stableId);
    const counts = new Map();
    bases.forEach((id) => counts.set(id, (counts.get(id) || 0) + 1));
    const occurrences = new Map();
    const reserved = new Set(bases);
    return elements.map((el, i) => {
      const base = bases[i];
      const occurrence = (occurrences.get(base) || 0) + 1;
      occurrences.set(base, occurrence);
      let id = base;
      if (counts.get(base) > 1) {
        id = `${base}__${occurrence}`;
        while (reserved.has(id)) id += '_';
        reserved.add(id);
      }
      const type = (el.type || "").toLowerCase();
      const grouped =
        type === "radio" ||
        (el.getAttribute("role") || "").toLowerCase() === "radiogroup";
      const label = grouped ? groupLabelFor(el) : labelFor(el);
      return {
        id,
        label: label.replace(/\s*\*\s*$/, "").slice(0, 300),
        type: fieldType(el),
        required: isRequired(el, label),
        options: optionsFor(el),
        value: currentValue(el),
        autocomplete: el.getAttribute('autocomplete') || '',
        inputType: (el.type || '').toLowerCase(),
        context: cleanText(el.closest('fieldset')?.querySelector('legend')?.textContent || ''),
        maxLength: Number.isInteger(el.maxLength) && el.maxLength > 0 ? el.maxLength : undefined,
        instructions: instructionsFor(el),
        el,
      };
    });
  }

  /** A cheap fingerprint used to tell "the page changed" from "it didn't". */
  function pageSignature() {
    const ids = scanFields()
      .map((f) => `${f.id}:${f.label}:${f.type}:${f.required ? 'required' : 'optional'}:${f.maxLength || ''}:${f.instructions || ''}:${f.el.tagName === 'SELECT' ? (f.options || []).join('~') : ''}`)
      .sort()
      .join("|");
    return `${location.href}::${currentStepLabel()}::${ids}`;
  }

  window.__screenmateScan = {
    scanFields,
    pageContext,
    contextForMessage,
    setParentContext,
    labelFor,
    groupLabelFor,
    currentValue,
    pageSignature,
    deepQueryAll,
    cleanText,
    isVisible,
    referencedElement,
    radioMembers,
    isPlaceholderOption,
  };
})();
