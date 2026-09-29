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

  /**
   * Walks open shadow roots, which native querySelectorAll will not enter —
   * except SCREENMATE's own panel: its answer boxes and buttons are not part
   * of the application, and reading them as fields would have the agent fill
   * in its own panel.
   */
  function deepQueryAll(selector, root = document, out = [], depth = 0) {
    if (depth > 12) return out;
    try {
      out.push(...root.querySelectorAll(selector));
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot && el.id !== "screenmate-root") {
          deepQueryAll(selector, el.shadowRoot, out, depth + 1);
        }
      }
    } catch {
      /* a detached or hostile root should never break the scan */
    }
    return out;
  }

  function isVisible(el) {
    if (el.closest?.('[hidden], [inert], [aria-hidden="true"]')) return false;
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
  const norm = (s) => cleanText(s).toLowerCase();

  /**
   * "Select…", "Please select", "-- Choose --", "Select your country":
   * prompts, not answers. "Choose not to disclose" is an answer, and a
   * protected question's decline option at that.
   */
  const PLACEHOLDER =
    /^[\s\-–—]*(please\s+)?(select|choose|pick)(\s+(one|an?|the|your)(\s+[\w/-]+){0,2})?[\s.…:\-–—]*$|^[\s\-–—.…]*$/i;

  /**
   * A native <select> marks its prompt with an empty value or a disabled first
   * option, whatever the text says. Reading "Please select" as an answer is how
   * a sensitive question gets skipped as already done.
   */
  const isPlaceholderOption = (o) =>
    !o ||
    (o.index === 0 && (o.value === "" || o.disabled)) ||
    PLACEHOLDER.test(cleanText(o.textContent));

  /**
   * What a widget calls itself when nobody labelled it: "Select…", "Search",
   * "Type here". Rippling puts aria-label="Select" on every dropdown, so taking
   * that as the question would ask you "Select?" instead of what the form asks.
   * "Select your gender" is a real label and is not caught here.
   */
  const GENERIC_NAME =
    /^[\s\-–—]*(please\s+)?(select|choose|pick|search|type|enter|start\s+typing|find)(\s+(here|one|an?\s+option|option|options|value|an?\s+answer|below))?[\s.…:\-–—]*$/i;
  const isGeneric = (s) => !cleanText(s) || GENERIC_NAME.test(cleanText(s).replace(/\s+required$/i, ""));

  /** Workday and friends hang stable hooks off data-automation-id. */
  const automationId = (el) =>
    el.getAttribute?.("data-automation-id") ||
    el.getAttribute?.("data-testid") ||
    el.getAttribute?.("data-qa") ||
    el.getAttribute?.("data-ui") ||
    "";

  /** Text that decorates a label rather than naming it. */
  const NOISE = [
    /no location found[\s\S]*$/i,
    /try entering a different/i,
    /\(optional\)\s*$/i,
    /this field is required[\s\S]*$/i,
    /please enter[\s\S]*$/i,
    /must be a valid[\s\S]*$/i,
    /\btotal \d+ files? selected\b/i,
    /\bno file (chosen|selected)\b/i,
    /\s+(choose|select|browse|upload|attach)( a)? files?\s*$/i,
  ];

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

  /**
   * Reads an element's label text without the scaffolding around it.
   *
   * Real forms hang required markers and validation messages inside the same
   * node as the label — Lever renders `<span class="required">✱</span>` inline,
   * so a naive textContent yields "Full name✱" or, worse, "Current location ✱No
   * location found. Try entering a different…". Both break topic matching, and a
   * mangled label is how a sensitive question gets classified safe.
   */
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
    "[class*=Label], [class*=question-text], [class*=questionText], " +
    '[id$="-label"], [id$="_label"], h1, h2, h3, h4, h5, h6';

  /** The controls a form is made of, native and ARIA. */
  const WIDGET_SELECTOR = [
    "input",
    "select",
    "textarea",
    "[role=textbox]",
    "[role=combobox]",
    'button[aria-haspopup="listbox"]:not([data-automation-id="utilityMenuButton"])',
    "[role=listbox]",
    "[role=radiogroup]",
    "[role=checkbox]",
    "[role=switch]",
    "[contenteditable=true]",
  ].join(",");

  /** The document or shadow root an element lives in, for id lookups. */
  const rootOf = (el) => {
    const r = el?.getRootNode?.();
    return r && typeof r.getElementById === "function" ? r : document;
  };
  const byId = (el, id) => rootOf(el).getElementById(id) || document.getElementById(id);

  /** True when this node names a field rather than being part of one. */
  function isLabelCandidate(node, el) {
    if (!node || node.contains(el)) return false;
    if (node.querySelector("input, select, textarea")) return false;
    const t = labelText(node);
    // Real custom questions run long ("Tell us about an AI workflow you've
    // built… which tools… how did you track drift?"). Too tight a cap skips
    // the question and settles on the section heading above it.
    return Boolean(t) && t.length > 1 && t.length < 600;
  }

  /** A <label for> that points at some other control ("Phone" beside a consent box). */
  function namesOther(node, el, members = [el]) {
    if (node.tagName !== "LABEL" || !node.htmlFor) return false;
    const target = byId(node, node.htmlFor);
    return Boolean(target && !members.some((m) => m === target || target.contains(m)));
  }

  /** A control someone could fill, as opposed to a hidden helper input. */
  const isRealControl = (c) => {
    if (c.tagName === "INPUT" && SKIP_TYPES.has((c.type || "").toLowerCase())) return false;
    if (c.tagName === "INPUT" && (c.type || "").toLowerCase() === "file") return true;
    return isVisible(c);
  };

  /**
   * True when another control sits between a label and this one: the label
   * then names that control, and taking it would give this field a neighbour's
   * question.
   */
  function controlBetween(label, el, scope, members = [el]) {
    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
    for (const c of scope.querySelectorAll(WIDGET_SELECTOR)) {
      if (members.some((m) => m === c || m.contains(c) || c.contains(m))) continue;
      if (!(label.compareDocumentPosition(c) & FOLLOWING)) continue;
      if (!(c.compareDocumentPosition(el) & FOLLOWING)) continue;
      if (isRealControl(c)) return true;
    }
    return false;
  }

  const countControls = (node) =>
    [...node.querySelectorAll(WIDGET_SELECTOR)].filter(isRealControl).length;

  /**
   * The label nearest before this control, walking outward. closest() alone
   * stops at the first container that matches, which on a real form is often
   * the inner field wrapper with no label inside it; and the first label in a
   * shared container is usually some other field's.
   */
  function nearestLabel(el, { exclude = () => false, members = [el], maxDepth = 8 } = {}) {
    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
    let node = el.parentElement;
    for (let depth = 0; depth < maxDepth && node; depth++, node = node.parentElement) {
      const candidates = [...node.querySelectorAll(LABEL_SELECTOR)].filter(
        (n) =>
          isLabelCandidate(n, el) &&
          !namesOther(n, el, members) &&
          !exclude(n) &&
          !isGeneric(labelText(n)),
      );
      if (candidates.length) {
        const before = candidates.filter((n) => n.compareDocumentPosition(el) & FOLLOWING);
        const pick = before[before.length - 1];
        if (pick) {
          // Separated from us by another control: it is that control's label,
          // and nothing further out will be ours either.
          return controlBetween(pick, el, node, members) ? "" : labelText(pick);
        }
        // Nothing before it, and nothing else lives here: a label after the
        // control (a checkbox's) is still its own.
        if (countControls(node) <= members.length) return labelText(candidates[0]);
      }
      if (node.tagName === "FORM" || node.tagName === "BODY") break;
    }
    return "";
  }

  /**
   * The text written just before a control that no label names. Rippling asks
   * "Do you require sponsorship…?" in a bare paragraph above an unlabelled
   * dropdown; without this the question reads as "field-59" and a sensitive
   * question is classified safe. Stops at the previous control, so it never
   * borrows another field's question.
   */
  function precedingText(el, members = [el]) {
    const scope = el.closest("form") || rootOf(el).body || document.body;
    if (!scope) return "";
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    walker.currentNode = el;
    for (let steps = 0; steps < 120 && walker.previousNode(); steps++) {
      const n = walker.currentNode;
      if (n.nodeType === Node.ELEMENT_NODE) {
        if (
          n.matches(WIDGET_SELECTOR) &&
          !members.some((m) => m === n || m.contains(n) || n.contains(m)) &&
          isRealControl(n)
        ) {
          return "";
        }
        continue;
      }
      const parent = n.parentElement;
      if (!parent || !cleanText(n.nodeValue)) continue;
      if (parent.closest("button, [role=option], script, style, [aria-hidden=true], [data-testid=screen-reader-only]")) continue;
      if (members.some((m) => m.contains(parent) || parent.contains(m))) continue;
      const block = parent.closest("p, label, legend, h1, h2, h3, h4, h5, h6, li, td, th") || parent;
      const text = labelText(block.contains(el) ? parent : block);
      if (text && text.length > 2 && text.length < 600 && !isGeneric(text) && !UPLOAD_CHROME.test(text)) {
        return text;
      }
    }
    return "";
  }

  /** Text of the elements an aria-labelledby points at. */
  function labelledBy(el) {
    const ids = el.getAttribute?.("aria-labelledby");
    if (!ids) return "";
    // Tidied as a whole too: "Resume" + "Choose file" only reads as button
    // text once the parts are joined.
    return tidyLabel(
      ids
        .split(/\s+/)
        .map((id) => byId(el, id))
        .filter((n) => n && n !== el && !n.contains(el))
        .map(labelText)
        .filter(Boolean)
        .join(" "),
    );
  }

  function labelFor(el) {
    // Workday's accessible button name includes the current choice and
    // "Required". The associated label is the stable question, not that name.
    if (el.getAttribute("aria-haspopup") === "listbox" && el.id) {
      const selector = `label[for="${CSS.escape(el.id)}"]`;
      const label = labelText(rootOf(el).querySelector(selector) || document.querySelector(selector));
      if (label && !isGeneric(label)) return label;
    }
    // aria-labelledby outranks aria-label, as it does for a screen reader.
    const viaIds = labelledBy(el);
    if (viaIds && !isGeneric(viaIds)) return viaIds;

    const byAria = tidyLabel(el.getAttribute("aria-label"));
    if (byAria && !isGeneric(byAria)) return byAria;

    if (el.id) {
      const sel = `label[for="${CSS.escape(el.id)}"]`;
      const text = labelText(rootOf(el).querySelector(sel) || document.querySelector(sel));
      if (text && !isGeneric(text)) return text;
    }

    const wrapping = el.closest("label");
    if (wrapping) {
      const viaWrap = labelledBy(wrapping);
      if (viaWrap && !isGeneric(viaWrap)) return viaWrap;
      // Prefer the inner label node, which excludes the field and its errors.
      const inner = [...wrapping.querySelectorAll("[class*=label], [class*=Label]")].find((n) =>
        isLabelCandidate(n, el),
      );
      const text = inner ? labelText(inner) : labelText(wrapping);
      if (text && !isGeneric(text)) return text;
    }

    // Workday puts rich questions in a legend, sometimes after a long legal
    // explanation. Keep the final question instead of borrowing a heading.
    const fieldset = el.closest("fieldset");
    if (fieldset && countControls(fieldset) === 1) {
      const legend = fieldset.querySelector("legend");
      const parts = [...(legend?.querySelectorAll("p") || [])].map(labelText).filter(Boolean);
      const question = parts.at(-1) || labelText(legend);
      if (question && !isGeneric(question)) return question;
    }

    const near = nearestLabel(el) || precedingText(el);
    if (near) return near;

    const placeholder = cleanText(el.getAttribute("placeholder"));
    return (
      (!isGeneric(placeholder) && placeholder) ||
      cleanText(automationId(el).replace(/[-_]/g, " ")) ||
      cleanText(el.getAttribute("name")) ||
      cleanText(el.id) ||
      "Untitled field"
    );
  }

  /** Text an upload widget's buttons wear, never the question it answers. */
  const UPLOAD_CHROME =
    /^(attach|upload|browse|paste|dropbox|google drive|enter manually|(choose|select|add|upload)( a)? files?|drop (files?|or select).*|or drag.*|drag and drop.*|accepted file types.*)$/i;

  /**
   * An upload's own label is often just its button ("Attach", on Greenhouse),
   * which says nothing about whether it wants a resume or a cover letter.
   * Walk up to the real question instead, falling back to the input's id.
   */
  function uploadLabelFor(el) {
    const own = labelFor(el);
    if (!UPLOAD_CHROME.test(own) && own !== "Untitled field") return own;
    const near = nearestLabel(el, {
      maxDepth: 6,
      exclude: (n) => UPLOAD_CHROME.test(labelText(n)),
    });
    if (near) return near;
    const id = cleanText((el.id || el.getAttribute("name") || "").replace(/[-_]+/g, " "));
    return id ? id.charAt(0).toUpperCase() + id.slice(1) : own;
  }

  /**
   * Resume "autofill" drop zones (Ashby's) ask for nothing: attaching a file
   * there makes the site rewrite the form from its own parse of it.
   */
  function isAutofillUpload(el, label) {
    return (
      /autofill|auto-fill|parse (my|your) resume|import (from )?(resume|linkedin)/i.test(label) ||
      Boolean(el.closest("[class*=autofill], [class*=Autofill]"))
    );
  }

  /** Every input in a native radio or checkbox group, in page order. */
  function groupMembers(el) {
    const type = (el.type || "").toLowerCase();
    if (el.tagName !== "INPUT" || (type !== "radio" && type !== "checkbox") || !el.name) {
      return [el];
    }
    const all = [
      ...rootOf(el).querySelectorAll(`input[type=${type}][name="${CSS.escape(el.name)}"]`),
    ];
    return all.length ? all : [el];
  }

  const isCheckboxGroup = (el) =>
    el.tagName === "INPUT" &&
    (el.type || "").toLowerCase() === "checkbox" &&
    groupMembers(el).length > 1;

  /** The smallest element holding every member. */
  function commonAncestor(members) {
    let node = members[0].parentElement;
    while (node && !members.every((m) => node.contains(m))) node = node.parentElement;
    return node;
  }

  /**
   * Text in a container that belongs to none of its options and none of the
   * other controls: Ashby writes a consent question as a plain paragraph above
   * its radios, with no label element at all.
   */
  function ownText(box, members) {
    const clone = box.cloneNode(true);
    const drop = new Set();
    const markers = [];
    // Mark what to remove in the original, then strip it from the clone.
    const walk = (orig) => {
      for (const n of orig.querySelectorAll("label, input, select, textarea, button, [role=option], [role=radio], [role=checkbox]")) {
        if (n.tagName === "LABEL" && (namesOther(n, members[0], members) || members.some((m) => n.contains(m)))) drop.add(n);
        else if (n.tagName !== "LABEL") drop.add(n);
      }
    };
    walk(box);
    const all = [...box.querySelectorAll("*")];
    const cloned = [...clone.querySelectorAll("*")];
    all.forEach((n, i) => {
      if (drop.has(n)) markers.push(cloned[i]);
    });
    markers.forEach((n) => n.remove());
    const text = tidyLabel(clone.textContent);
    return text.length > 2 ? text.slice(0, 300) : "";
  }

  /**
   * The question a grouped control belongs to.
   *
   * A radio wrapped in `<label>Yes</label>` answers "Yes" — but the field is
   * "Will you require visa sponsorship?". Reading an option's own label here
   * is not just cosmetic: it is how a sensitive question gets classified safe.
   */
  function groupLabelFor(el) {
    const byAria = labelledBy(el) || tidyLabel(el.getAttribute("aria-label"));
    if (byAria && !isGeneric(byAria)) return byAria;

    const members = groupMembers(el);
    const isAriaGroup = el.getAttribute("role") === "radiogroup";
    const optionTexts = new Set(
      (isAriaGroup ? [...el.querySelectorAll("[role=radio]")] : members).map((m) =>
        norm(m.tagName === "INPUT" ? labelFor(m) : m.getAttribute("aria-label") || m.textContent),
      ),
    );
    const inOption = (n) =>
      members.some((m) => {
        const wrap = m.closest("label");
        return (wrap && (wrap === n || wrap.contains(n))) || n.contains(m);
      }) || (isAriaGroup && el.contains(n));
    const exclude = (n) => inOption(n) || optionTexts.has(norm(labelText(n)));

    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
    let box = isAriaGroup ? el.parentElement : commonAncestor(members);
    for (let depth = 0; depth < 7 && box; depth++, box = box.parentElement) {
      const group = box.closest?.("fieldset, [role=group], [role=radiogroup]");
      const legend = group?.querySelector(":scope > legend");
      if (legend && !exclude(legend) && labelText(legend)) return labelText(legend);
      const viaGroup = box !== el && (labelledBy(box) || tidyLabel(box.getAttribute("aria-label")));
      if (viaGroup && !isGeneric(viaGroup) && !optionTexts.has(norm(viaGroup))) return viaGroup;

      const candidates = [...box.querySelectorAll(LABEL_SELECTOR)].filter(
        (n) =>
          isLabelCandidate(n, el) &&
          !exclude(n) &&
          !namesOther(n, el, members) &&
          !isGeneric(labelText(n)),
      );
      const before = candidates.filter((n) => n.compareDocumentPosition(el) & FOLLOWING);
      const pick = before[before.length - 1];
      if (pick && !controlBetween(pick, el, box, members)) return labelText(pick);
      // Only while nothing but this question lives here: past that, the
      // loose text belongs to some other field.
      if (!pick && countControls(box) <= (isAriaGroup ? 1 : members.length)) {
        const text = ownText(box, members);
        if (text && !optionTexts.has(norm(text))) return text;
      }
      if (box.tagName === "FORM" || box.tagName === "BODY") break;
    }
    const before = precedingText(el, members);
    return before && !optionTexts.has(norm(before)) ? before : labelFor(el);
  }

  function isRequired(el, label) {
    if (el.required || el.getAttribute("aria-required") === "true") return true;
    if (/\brequired\s*$/i.test(el.getAttribute("aria-label") || "")) return true;
    if (/\*\s*$/.test(label)) return true;
    const role = (el.getAttribute("role") || "").toLowerCase();
    if (role === "radiogroup" && el.querySelector('[aria-required="true"], [required]')) return true;
    if (groupMembers(el).some((m) => m.required)) return true;
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
    if (role === "combobox" || role === "listbox" || el.getAttribute("aria-haspopup") === "listbox") return "select";
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

  /* ---------------- stable ids ---------------- */

  /**
   * Ids a framework mints from a render counter. They change when the page
   * re-renders, which would make an answered question look new.
   */
  const AUTO_ID =
    /^(react-select-\d+-input|:r[0-9a-z]*:|radix-[\w:-]+|headlessui-[\w-]+|mui-\d+|downshift-\d+-input)$/i;

  /** Hooks a field's own container carries when the control carries none. */
  const CONTAINER_HOOKS = [
    "data-field-path",
    "data-automation-id",
    "data-testid",
    "data-qa",
    "data-ui",
    "data-field-id",
    "data-question-id",
  ];
  const GENERIC_HOOK = /^(field|form-?field|input|select-controller|screen-reader-only|question)$/i;

  function containerHook(el) {
    let node = el.parentElement;
    for (let depth = 0; depth < 5 && node && node !== document.body; depth++) {
      // A container holding other fields names a section, not this field.
      if (countControls(node) > groupMembers(el).length) return "";
      for (const attr of CONTAINER_HOOKS) {
        const v = node.getAttribute(attr);
        if (v && !GENERIC_HOOK.test(v)) return v;
      }
      node = node.parentElement;
    }
    return "";
  }

  const slug = (s) =>
    norm(s)
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48);

  const idOf = new WeakMap();
  const owners = new Map();

  /**
   * An id that stays the same for the same question for as long as the page
   * lives. It used to fall back to the control's position, so a field that
   * appeared above it renamed it — and a question you had already answered
   * came back as new.
   */
  function stableId(el, label) {
    const known = idOf.get(el);
    if (known) return known;
    const own =
      automationId(el) ||
      el.getAttribute("name") ||
      (el.id && !AUTO_ID.test(el.id) ? el.id : "");
    const raw =
      own ||
      containerHook(el) ||
      el.id ||
      `q_${slug(label ?? labelFor(el)) || el.tagName.toLowerCase()}`;
    const base = raw.replace(/[^\w.:\-[\]]/g, "_").slice(0, 120);
    let id = base;
    for (let n = 2; owners.has(id) && owners.get(id) !== el && owners.get(id).isConnected; n++) {
      id = `${base}~${n}`;
    }
    owners.set(id, el);
    idOf.set(el, id);
    return id;
  }

  /* ---------------- options + values ---------------- */

  /** Options longer than this are cut for the server; writers match on the prefix. */
  const OPTION_MAX = 200;
  const clip = (list) =>
    list
      .map((o) => (o.length > OPTION_MAX ? o.slice(0, OPTION_MAX) : o))
      .filter(Boolean)
      .slice(0, 60);

  /** Options for a native select, a radio or checkbox group, or an ARIA listbox widget. */
  function optionsFor(el) {
    const tag = el.tagName.toLowerCase();
    const role = (el.getAttribute("role") || "").toLowerCase();
    const type = (el.type || "").toLowerCase();

    if (tag === "select") {
      return clip(
        Array.from(el.options)
          .filter((o) => !isPlaceholderOption(o))
          .map((o) => cleanText(o.textContent)),
      );
    }

    if (type === "radio" || isCheckboxGroup(el)) {
      return clip(groupMembers(el).map((r) => labelFor(r)));
    }

    if (role === "radiogroup") {
      return clip(
        Array.from(el.querySelectorAll("[role=radio]")).map((r) =>
          cleanText(r.getAttribute("aria-label") || r.textContent),
        ),
      );
    }

    if (type === "checkbox" || role === "checkbox" || role === "switch") {
      return ["Checked", "Unchecked"];
    }

    // ARIA combobox: options usually live in a popup referenced by id, and only
    // exist in the DOM once opened. Read them if present, otherwise leave empty
    // and let the writer discover them when it opens the control.
    if (role === "combobox" || role === "listbox" || el.getAttribute("aria-haspopup") === "listbox") {
      const owned =
        el.getAttribute("aria-controls") || el.getAttribute("aria-owns") || "";
      const popup = owned
        ? byId(el, owned.split(/\s+/)[0])
        : el.querySelector("[role=listbox]");
      if (popup) {
        return clip(
          Array.from(popup.querySelectorAll("[role=option]")).map((o) =>
            cleanText(o.getAttribute("aria-label") || o.textContent),
          ),
        );
      }
    }

    return undefined;
  }

  /** Separates the chosen options of a multi-choice field. */
  const MULTI_SEPARATOR = "; ";

  function currentValue(el) {
    // Never read a file path off the user's machine.
    if ((el.type || "").toLowerCase() === "file") {
      return el.files?.length ? `${el.files.length} file selected` : "";
    }
    const tag = el.tagName.toLowerCase();
    const role = (el.getAttribute("role") || "").toLowerCase();
    const t = (el.type || "").toLowerCase();

    if (t === "checkbox") {
      if (isCheckboxGroup(el)) {
        return groupMembers(el)
          .filter((m) => m.checked)
          .map((m) => labelFor(m))
          .join(MULTI_SEPARATOR);
      }
      // Unticked is no answer: a required box left empty must read as empty.
      return el.checked ? "Checked" : "";
    }
    if (role === "checkbox" || role === "switch") {
      return el.getAttribute("aria-checked") === "true" ? "Checked" : "";
    }
    if (t === "radio") {
      const checked = groupMembers(el).find((m) => m.checked);
      return checked ? labelFor(checked) : "";
    }
    if (role === "radiogroup") {
      const checked = el.querySelector('[role=radio][aria-checked="true"]');
      return checked
        ? cleanText(checked.getAttribute("aria-label") || checked.textContent)
        : "";
    }
    if (tag === "select") {
      if (el.multiple) return Array.from(el.selectedOptions || []).filter(o => !isPlaceholderOption(o))
        .map(o => cleanText(o.textContent)).join(MULTI_SEPARATOR);
      const selected = el.selectedOptions?.[0];
      return isPlaceholderOption(selected) ? "" : cleanText(selected.textContent);
    }
    if (role === "combobox" || role === "listbox" || el.getAttribute("aria-haspopup") === "listbox") {
      // react-select (Greenhouse) empties its input once something is chosen
      // and shows the choice in an element beside it.
      const shown =
        el.tagName === "INPUT" && !el.value
          ? [
              ...(el
                .closest("[class*=control]")
                ?.querySelectorAll(
                  "[class*=single-value], [class*=singleValue], [class*=multi-value__label]",
                ) || []),
            ]
              .map((n) => cleanText(n.textContent))
              .filter(Boolean)
              .join(", ")
          : "";
      // Workday renders the chosen value as the button's own text.
      const raw = cleanText(
        shown || (tag === "button" ? el.textContent : el.value) || el.getAttribute("aria-valuetext") || el.textContent,
      )
        // Custom controls fold their chevron into textContent.
        .replace(/[▾▴▼▲⌄⌃˅˄]+\s*$/, "")
        .trim();
      return PLACEHOLDER.test(raw) || isGeneric(raw) ? "" : raw;
    }
    if (el.isContentEditable) return cleanText(el.textContent);
    return el.value || "";
  }

  /* ---------------- collection ---------------- */

  /** Collects controls, collapsing radio and checkbox groups to one logical field. */
  function collectElements() {
    const nodes = deepQueryAll(WIDGET_SELECTOR);
    const seenGroups = new Set();
    const seen = new Set();
    const out = [];

    for (const el of nodes) {
      if (seen.has(el)) continue;
      seen.add(el);

      // `.type` is only meaningful on <input>. A <button role="combobox"> — the
      // standard Workday dropdown — reports type "submit" and would otherwise be
      // skipped as a submit control.
      const isInput = el.tagName.toLowerCase() === "input";
      const type = (el.type || "text").toLowerCase();
      if (isInput && SKIP_TYPES.has(type)) continue;
      // Upload inputs are usually hidden behind a styled "Attach" button
      // (Lever, Greenhouse), so for them only disabled counts as unusable.
      const isUpload = isInput && type === "file";
      if (isUpload ? el.disabled : !isVisible(el)) continue;

      const identity = `${el.name || ""} ${el.id || ""} ${automationId(el)} ${
        el.getAttribute("autocomplete") || ""
      }`;
      if (SECRET_HINT.test(identity) || SECRET_HINT.test(labelFor(el))) continue;

      // A radiogroup wrapper supersedes its individual radios.
      if (el.closest("[role=radiogroup]") && el.getAttribute("role") !== "radiogroup") {
        continue;
      }
      // One field per radio group, and per group of same-named checkboxes
      // (Lever's "check all that apply" is thirty boxes sharing one name).
      if (isInput && (type === "radio" || (type === "checkbox" && isCheckboxGroup(el)))) {
        const key = `${type}:${el.name || el.id}`;
        if (seenGroups.has(key)) continue;
        seenGroups.add(key);
      }
      out.push(el);
    }
    return out;
  }

  /** How many controls a page has, without the cost of reading them. */
  const quickCount = () => deepQueryAll(WIDGET_SELECTOR).length;

  /* ---------------- page context ---------------- */

  /** Brands of the hiring software itself, never the employer. */
  const ATS_BRAND =
    /^(greenhouse|lever|ashby|ashbyhq|workday|workable|smartrecruiters|icims|bamboohr|jazzhr|jobvite|recruitee|teamtailor|rippling|breezy|breezy hr|personio|pinpoint|gem|dover|wellfound|linkedin|indeed|careers|jobs|job board|powered by .+)$/i;

  const titleCase = (s) =>
    s
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());

  /**
   * The employer's slug, where the hiring software puts it in the address:
   * job-boards.greenhouse.io/discord, jobs.lever.co/palantir,
   * nvidia.wd5.myworkdayjobs.com.
   */
  function atsSlug(loc) {
    const host = loc.hostname.toLowerCase();
    const parts = loc.pathname.split("/").filter(Boolean);
    const first = (parts[0] || "").toLowerCase();
    const inPath =
      /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|rippling\.com|jobvite\.com|breezy\.hr|gem\.com|pinpointhq\.com|dover\.com|wellfound\.com)$/;
    if (inPath.test(host)) {
      if (/greenhouse\.io$/.test(host) && first === "embed") {
        return new URLSearchParams(loc.search).get("for") || "";
      }
      if (/smartrecruiters\.com$/.test(host)) return "";
      return ["j", "jobs", "embed", "o", "careers"].includes(first) ? parts[1] || "" : first;
    }
    if (/smartrecruiters\.com$/.test(host)) {
      const company = loc.pathname.match(/\/company\/([^/]+)/)?.[1];
      return company || (first !== "oneclick-ui" ? parts[0] || "" : "");
    }
    const sub =
      /^([a-z0-9-]+)\.(wd\d+\.)?(myworkdayjobs\.com|bamboohr\.com|applytojob\.com|recruitee\.com|teamtailor\.com|breezy\.hr|jobs\.personio\.(com|de)|icims\.com|pinpointhq\.com)$/.exec(
        host,
      );
    return sub ? sub[1].replace(/^careers-/, "") : "";
  }

  /** hiringOrganization from a schema.org JobPosting, when the page has one. */
  function jsonLdPosting(doc) {
    for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(s.textContent);
        const items = [data, ...(Array.isArray(data) ? data : []), ...(data?.["@graph"] || [])];
        const posting = items.find((i) => i && i["@type"] === "JobPosting");
        if (posting) {
          const org = posting.hiringOrganization;
          return {
            company: cleanText(typeof org === "string" ? org : org?.name),
            title: cleanText(posting.title),
          };
        }
      } catch {
        /* malformed JSON-LD is common and never fatal */
      }
    }
    return null;
  }

  /**
   * The employer's name. A hostname alone gives "job-boards" or "jobs" on the
   * hiring platforms most applications live on, and that name then goes into
   * the research query, the agent's prompt, and the submit button.
   */
  function companyFrom(doc, loc) {
    const squash = (s) => norm(s).replace(/[^a-z0-9]/g, "");
    const usable = (c) => c && c.length < 60 && !ATS_BRAND.test(c);
    const slug = atsSlug(loc);
    const title = cleanText(doc.title);
    const meta = (sel) => cleanText(doc.querySelector(sel)?.getAttribute("content"));
    // Places a page states its employer outright.
    const named = [
      jsonLdPosting(doc)?.company,
      title.match(/\bat\s+([^|–—]+?)\s*$/i)?.[1],
      title.match(/@\s*([^|–—]+?)\s*$/)?.[1],
      ...[
        ...doc.querySelectorAll(
          "header img[alt], nav img[alt], a img[alt], img[class*=logo][alt], img[alt*=logo i]",
        ),
      ].map((i) => cleanText(i.alt).replace(/\s*\blogo\b\s*/i, " ")),
      meta('meta[property="og:site_name"]').replace(/\s+(recruiting|careers|jobs)$/i, ""),
    ]
      .map(cleanText)
      .filter(usable);

    if (slug) {
      // The address names the employer; the page supplies its proper spelling
      // ("palantir" → "Palantir Technologies", "huggingface" → "Hugging Face").
      const s = squash(slug);
      const parts = title.split(/\s+[-–|]\s+/).map(cleanText).filter(usable);
      const match = [...named, ...parts].find((c) => {
        const q = squash(c);
        if (!q) return false;
        if (q === s) return true;
        return s.length >= 3 && q.length >= 3 && (q.startsWith(s) || s.startsWith(q));
      });
      return match || titleCase(slug);
    }
    if (named.length) return named[0];
    return titleCase(
      loc.hostname
        .replace(/^(www|careers|jobs|apply|boards|job-boards|join|work)\./, "")
        .split(".")[0],
    );
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

    // An embedded form knows its employer from its own address (?for=acme).
    const company =
      companyFrom(doc, host.location) ||
      (host !== window ? companyFrom(document, window.location) : "");

    let jobTitle =
      jsonLdPosting(doc)?.title ||
      cleanText(doc.querySelector("h1")?.textContent) ||
      meta('meta[property="og:title"]') ||
      cleanText(doc.title);
    // "Palantir Technologies - Administrative Business Partner" is the title
    // with the employer glued on the front.
    if (company && jobTitle.toLowerCase().startsWith(`${company.toLowerCase()} - `)) {
      jobTitle = jobTitle.slice(company.length + 3);
    }

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

  /* ---------------- scan ---------------- */

  function scanFields() {
    const out = [];
    for (const el of collectElements()) {
      const type = (el.type || "").toLowerCase();
      const grouped =
        type === "radio" ||
        isCheckboxGroup(el) ||
        (el.getAttribute("role") || "").toLowerCase() === "radiogroup";
      const label = grouped
        ? groupLabelFor(el)
        : type === "file"
          ? uploadLabelFor(el)
          : labelFor(el);
      if (type === "file" && isAutofillUpload(el, label)) continue;
      out.push({
        id: stableId(el, label),
        label: label.replace(/\s*\*\s*$/, "").slice(0, 300),
        type: fieldType(el),
        required: isRequired(el, label),
        options: optionsFor(el),
        multiple: isCheckboxGroup(el) || el.multiple === true || el.getAttribute("aria-multiselectable") === "true" || undefined,
        value: currentValue(el),
        el,
      });
    }
    // The classifier takes up to 200 fields; a form longer than that is
    // read from the top, which is where the questions that matter start.
    return out.slice(0, 200);
  }

  /** A cheap fingerprint used to tell "the page changed" from "it didn't". */
  function pageSignature() {
    const ids = collectElements()
      .map((el) => stableId(el))
      .sort()
      .join("|");
    return `${location.href}::${currentStepLabel()}::${ids}`;
  }

  window.__screenmateScan = {
    scanFields,
    pageContext,
    labelFor,
    groupLabelFor,
    groupMembers,
    isCheckboxGroup,
    currentValue,
    pageSignature,
    quickCount,
    deepQueryAll,
    cleanText,
    isVisible,
    isPlaceholderOption,
    MULTI_SEPARATOR,
  };
})();
