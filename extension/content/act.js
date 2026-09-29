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
  const { cleanText, groupMembers, isCheckboxGroup, MULTI_SEPARATOR } = window.__screenmateScan;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => cleanText(s || "").toLowerCase();
  const labelOf = (el) => window.__screenmateScan.labelFor(el);

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

  /**
   * A full press, in the order a pointer produces it. Widgets differ in which
   * event they act on — react-select (Greenhouse) opens on pointerdown or
   * mousedown and ignores a bare click, others wait for click — and el.click()
   * only ever sends the last one.
   */
  function press(el) {
    const init = { bubbles: true, cancelable: true, button: 0, buttons: 1, view: window };
    const pointer = (type) => {
      try {
        el.dispatchEvent(new PointerEvent(type, { ...init, pointerType: "mouse", isPrimary: true }));
      } catch {
        /* no PointerEvent: the mouse events below still go out */
      }
    };
    pointer("pointerdown");
    el.dispatchEvent(new MouseEvent("mousedown", init));
    pointer("pointerup");
    el.dispatchEvent(new MouseEvent("mouseup", init));
    el.dispatchEvent(new MouseEvent("click", init));
  }

  /**
   * Chooses one option of a styled radio or checkbox. Workable wraps a hidden
   * native input in a `role=radio` div: a click on the div reaches no handler,
   * so the input inside is what gets clicked. An option with no input is
   * pressed like a button.
   */
  function activate(target) {
    const input = target.matches?.("input")
      ? target
      : target.querySelector?.("input[type=radio], input[type=checkbox]");
    if (input) {
      input.click();
      return;
    }
    const label = target.closest?.("label") || target.querySelector?.("label");
    if (label) {
      label.click();
      return;
    }
    press(target);
  }

  /** Closes an open menu the way a person would: Escape, then leave the field. */
  function dismiss(el) {
    el.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape", keyCode: 27 }),
    );
    el.blur?.();
  }

  function focusQuietly(el) {
    try {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.focus({ preventScroll: true });
    } catch {
      /* a page may block focus; the write still applies */
    }
  }

  /* ---------------- matching an answer to a site's options ---------------- */

  const US_STATES = {
    al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california",
    co: "colorado", ct: "connecticut", de: "delaware", fl: "florida", ga: "georgia",
    hi: "hawaii", id: "idaho", il: "illinois", in: "indiana", ia: "iowa",
    ks: "kansas", ky: "kentucky", la: "louisiana", me: "maine", md: "maryland",
    ma: "massachusetts", mi: "michigan", mn: "minnesota", ms: "mississippi",
    mo: "missouri", mt: "montana", ne: "nebraska", nv: "nevada", nh: "new hampshire",
    nj: "new jersey", nm: "new mexico", ny: "new york", nc: "north carolina",
    nd: "north dakota", oh: "ohio", ok: "oklahoma", or: "oregon", pa: "pennsylvania",
    ri: "rhode island", sc: "south carolina", sd: "south dakota", tn: "tennessee",
    tx: "texas", ut: "utah", vt: "vermont", va: "virginia", wa: "washington",
    wv: "west virginia", wi: "wisconsin", wy: "wyoming", dc: "district of columbia",
  };
  const COUNTRY_ALIASES = [
    ["united states", "united states of america", "usa", "us", "america"],
    ["united kingdom", "uk"],
    ["united arab emirates", "uae"],
    ["south korea", "korea, republic of", "republic of korea"],
    ["netherlands", "the netherlands"],
    ["czech republic", "czechia"],
    ["russia", "russian federation"],
    ["vietnam", "viet nam"],
  ];

  /** One spelling per place, so "GA" meets "Georgia" and "USA" meets "United States". */
  function canonicalPlace(part) {
    const p = norm(part).replace(/\./g, "");
    if (US_STATES[p]) return US_STATES[p];
    const country = COUNTRY_ALIASES.find((names) => names.includes(p));
    return country ? country[0] : p;
  }

  /**
   * How well a site's option matches the answer, 0 to 100. Exact beats
   * prefix beats a place written differently ("Atlanta, Georgia" against
   * "Atlanta, GA, United States"). Options cut short for the server match on
   * what survived.
   */
  function optionScore(option, wanted) {
    const o = norm(option);
    const w = norm(wanted);
    if (!o || !w) return 0;
    if (o === w) return 100;
    if (canonicalPlace(o) === canonicalPlace(w)) return 96;
    if (/^(yes|no)$/i.test(w) && window.__screenmatePrefs &&
        !window.__screenmatePrefs.matchOption(w, [option])) return 0;
    const oParts = o.split(/\s*,\s*/).map(canonicalPlace);
    const wParts = w.split(/\s*,\s*/).map(canonicalPlace);
    const places = new Set([...Object.values(US_STATES), ...COUNTRY_ALIASES.flat()]);
    if (wParts.slice(1).some(p => places.has(p)) || oParts.slice(1).some(p => places.has(p))) {
      if (oParts[0] !== wParts[0] || wParts.length < 2) return 0;
      if (!wParts.slice(1).every(p => oParts.slice(1).includes(p))) return 0;
      const extra = oParts.slice(1).filter(p => !wParts.includes(p));
      const usState = wParts.slice(1).some(p => Object.values(US_STATES).includes(p));
      return extra.every(p => p === "united states" && usState) ? 84 : 0;
    }
    const atWord = (text, prefix) => text.startsWith(prefix) && !/[a-z0-9]/.test(text.charAt(prefix.length));
    if (atWord(o, w)) return 90;
    if (w.length >= 40 && o.startsWith(w)) return 88;
    if (o.length >= 40 && w.startsWith(o)) return 86;
    if (o.length >= 3 && atWord(w, o)) return 70;

    return 0;
  }

  /** The best-matching option, or null when nothing clears the bar. */
  function bestOption(options, textOf, wanted, floor = 60) {
    let best = null;
    let bestScore = floor - 1;
    let tied = false;
    for (const o of options) {
      const s = optionScore(textOf(o), wanted);
      if (s > bestScore) {
        best = o;
        bestScore = s;
        tied = false;
      } else if (s >= floor && s === bestScore) {
        tied = true;
      }
    }
    return tied ? null : best;
  }

  /**
   * The options a multi-choice answer names. The model sometimes separates
   * them with commas, and an option can contain one ("Yes, I have a
   * disability"), so commas are only split where the pieces are options.
   */
  function splitMulti(value, options) {
    const out = [];
    for (const chunk of String(value || "").split(/\s*[;\n|]\s*/).filter(Boolean)) {
      const whole = bestOption(options, (o) => o, chunk, 86);
      if (whole) {
        out.push(whole);
        continue;
      }
      const pieces = chunk.split(/\s*,\s*/);
      for (let i = 0; i < pieces.length; ) {
        let taken = false;
        for (let j = pieces.length; j > i; j--) {
          const hit = bestOption(options, (o) => o, pieces.slice(i, j).join(", "), 86);
          if (hit) {
            out.push(hit);
            i = j;
            taken = true;
            break;
          }
        }
        if (!taken) return [];
      }
    }
    return [...new Set(out)];
  }

  /* ---------------- native controls ---------------- */

  const MENU =
    "[role=listbox], [class*=dropdown], [class*=suggest], [class*=autocomplete], [class*=typeahead]";
  const SUGGESTION =
    "[role=option], li, [class*=option], [class*=result] > *, [class*=location], [class*=item]";

  /**
   * The field's own container, when it carries a suggestion menu. Stops at the
   * first ancestor shared with another control, so a menu elsewhere on the
   * form is never mistaken for this field's.
   */
  function suggestionScope(el) {
    let node = el.parentElement;
    for (let depth = 0; depth < 4 && node && node !== document.body; depth++) {
      if (node.querySelectorAll("input:not([type=hidden]), select, textarea").length > 1) {
        return null;
      }
      if ([...node.querySelectorAll(MENU)].some((m) => !m.contains(el))) return node;
      node = node.parentElement;
    }
    return null;
  }

  /**
   * Some sites drive their own suggestion menu off the keyboard and wipe typed
   * text that was not picked from it — Lever's location field does exactly
   * that on blur. Nudge the menu open and pick the suggestion that matches
   * what we typed, the way a person would. Returns the page's value, or null.
   */
  async function pickSuggestion(el, scope, value) {
    const last = value.slice(-1);
    el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: last }));
    el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: last }));

    // Menus are usually backed by a network search; allow ~3s for a slow one.
    for (let i = 0; i < 20; i++) {
      await sleep(150);
      const shown = [...scope.querySelectorAll(SUGGESTION)].filter(
        (n) =>
          n !== el &&
          !n.contains(el) &&
          norm(n.textContent) &&
          window.__screenmateScan.isVisible(n),
      );
      // Innermost only: a wrapper whose text happens to begin with the
      // suggestion (Lever's menu carries a utility class like "items-start")
      // is not the thing to click.
      const items = shown.filter((n) => !shown.some((m) => m !== n && n.contains(m)));
      const match = bestOption(items, (n) => n.textContent, value);
      if (match) {
        match.scrollIntoView?.({ block: "nearest" });
        press(match);
        await sleep(200);
        return cleanText(el.value) || null;
      }
    }
    return null;
  }

  async function writeText(el, value) {
    focusQuietly(el);
    nativeSetter(el, value);

    const scope = el.tagName === "INPUT" ? suggestionScope(el) : null;
    if (!scope) {
      // React listens for `input`; Vue and plain forms want `change` too.
      fire(el, "input", "change");
      el.blur?.();
      return { ok: true };
    }

    // Typed but not committed: a person picks from the menu before leaving
    // the field, and an early `change` reads as leaving without a choice.
    fire(el, "input");
    const chosen = await pickSuggestion(el, scope, value);
    if (!chosen) fire(el, "change");
    el.blur?.();
    // `chosen` is the site's own wording ("Atlanta, GA, USA"), which is what
    // verification has to compare against.
    return chosen ? { ok: true, chosen } : { ok: true };
  }

  function writeSelect(el, value) {
    if (el.multiple) {
      const options = Array.from(el.options).filter(o => !o.disabled && !window.__screenmateScan.isPlaceholderOption(o));
      const wanted = splitMulti(value, options.map(o => cleanText(o.textContent)));
      if (norm(value) && !wanted.length) return { ok: false, reason: `Some choices in "${value}" are not available` };
      for (const option of el.options) option.selected = wanted.includes(cleanText(option.textContent));
      fire(el, "input", "change");
      return { ok: true, chosen: wanted.join(MULTI_SEPARATOR) };
    }
    // Clearing (a revert) means going back to the prompt option, whatever
    // value that option happens to carry.
    const match = !norm(value)
      ? el.options[0]
      : bestOption(
          Array.from(el.options).filter((o) => !o.disabled && !window.__screenmateScan.isPlaceholderOption(o)),
          (o) => o.textContent,
          value,
        );
    if (!match) return { ok: false, reason: `No option matching "${value}"` };
    focusQuietly(el);
    nativeSetter(el, match.value);
    fire(el, "input", "change");
    return { ok: true, chosen: cleanText(match.textContent) };
  }

  function writeRadio(el, value) {
    const group = groupMembers(el);
    if (!norm(value)) {
      // A radio group cannot be emptied by clicking; say so rather than pretend.
      return group.some((r) => r.checked)
        ? { ok: false, reason: "A chosen radio option cannot be cleared automatically — change it on the page." }
        : { ok: true };
    }
    const target = bestOption(group, labelOf, value);
    if (!target) return { ok: false, reason: `No radio option matching "${value}"` };
    focusQuietly(target);
    if (!target.checked) activate(target);
    return { ok: true, chosen: labelOf(target) };
  }

  /** "Checked", "Yes", "True" tick a single box; anything else leaves it clear. */
  const isTick = (value) => /^(checked|yes|true|on|1|agree|i agree)$/i.test(String(value).trim());

  function writeCheckbox(el, value) {
    const want = isTick(value);
    if (el.checked !== want) {
      focusQuietly(el);
      el.click();
    }
    return { ok: true };
  }

  /** Ticks exactly the options named, and clears the rest. */
  function writeCheckboxGroup(el, value) {
    const members = groupMembers(el);
    const labels = members.map(labelOf);
    const wanted = splitMulti(value, labels);
    if (norm(value) && !wanted.length) {
      return { ok: false, reason: `No option matching "${value}"` };
    }
    members.forEach((m, i) => {
      const want = wanted.includes(labels[i]);
      if (m.checked !== want) {
        focusQuietly(m);
        m.click();
      }
    });
    return { ok: true, chosen: wanted.join(MULTI_SEPARATOR) };
  }

  /* ---------------- ARIA / custom widgets ---------------- */

  function writeAriaRadioGroup(el, value) {
    const options = Array.from(el.querySelectorAll("[role=radio]"));
    const textOf = (o) => o.getAttribute("aria-label") || o.textContent;
    const target = bestOption(options, textOf, value);
    if (!target) return { ok: false, reason: `No option matching "${value}"` };
    focusQuietly(target);
    if (target.getAttribute("aria-checked") !== "true") activate(target);
    return { ok: true, chosen: cleanText(textOf(target)) };
  }

  function writeAriaCheckbox(el, value) {
    const want = isTick(value);
    const is = el.getAttribute("aria-checked") === "true";
    if (is !== want) {
      focusQuietly(el);
      activate(el);
    }
    return { ok: true };
  }

  function writeContentEditable(el, value) {
    focusQuietly(el);
    el.textContent = value;
    fire(el, "input", "change");
    return { ok: true };
  }

  const isTypeaheadInput = (el) =>
    el.tagName.toLowerCase() === "input" &&
    Boolean(el.getAttribute("aria-autocomplete") || el.getAttribute("autocomplete") === "off");

  /** The listbox a combobox controls, wherever the page rendered it. */
  function findPopup(el) {
    const owned = el.getAttribute("aria-controls") || el.getAttribute("aria-owns") || "";
    const byId = owned ? document.getElementById(owned.split(/\s+/)[0]) : null;
    if (byId) return byId;
    const inside = el.querySelector("[role=listbox]");
    if (inside) return inside;
    // Workday portals its menus to the end of <body>.
    const loose = window.__screenmateScan.deepQueryAll("[role=listbox]");
    return loose.reverse().find((n) => window.__screenmateScan.isVisible(n)) || null;
  }

  const optionText = (o) => cleanText(o.getAttribute("aria-label") || o.textContent);

  /**
   * Empties a combobox, for a revert. Reports success only if it really is
   * empty: many dropdowns cannot be cleared at all once set.
   */
  async function clearCombobox(el, isTypeahead) {
    const control = el.closest("[class*=control]") || el.parentElement;
    const clear = control?.querySelector(
      "[class*=clear-indicator], [class*=clearIndicator], [aria-label^='clear' i]",
    );
    if (clear) {
      press(clear);
    } else if (isTypeahead) {
      focusQuietly(el);
      el.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Backspace", keyCode: 8 }),
      );
    }
    await sleep(150);
    dismiss(el);
    return window.__screenmateScan.currentValue(el)
      ? { ok: false, reason: "This dropdown cannot be cleared automatically — clear it on the page." }
      : { ok: true };
  }

  /** Types into a typeahead the way a person does, so its search runs. */
  async function typeQuery(el, text) {
    nativeSetter(el, "");
    fire(el, "input");
    await sleep(60);
    nativeSetter(el, text);
    fire(el, "input", "keyup");
    el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: text.slice(-1) || "a" }));
    await sleep(220);
  }

  /** Polls the combobox's popup for an option matching `value`, for up to ~ms. */
  async function waitForOption(el, value, ms) {
    let popup = null;
    let options = [];
    let target = null;
    for (let waited = 0; waited <= ms && !target; waited += 100) {
      popup = findPopup(el);
      options = popup ? Array.from(popup.querySelectorAll("[role=option], li, button")) : [];
      // Innermost only, as with suggestion menus.
      options = options.filter((o) => !options.some((p) => p !== o && o.contains(p)));
      target = bestOption(options, optionText, value);
      if (!target) await sleep(100);
    }
    return { popup, options, target };
  }

  /**
   * Operates a combobox: open it, wait for the popup and its options, pick the
   * matching one. Async because the popup is usually not in the DOM until the
   * trigger is pressed, and searchable lists fill in over the network.
   */
  async function writeCombobox(el, value) {
    focusQuietly(el);

    // A typeahead is an <input> that filters its list as you type.
    const isTypeahead = isTypeaheadInput(el);

    // A revert means emptying the control. Matching "" would pick whichever
    // option happens to start with it — the first one.
    if (!norm(value)) return clearCombobox(el, isTypeahead);

    // Open it first. react-select only shows a menu once pressed; a typeahead
    // that opens as you type just ignores the press.
    press(el);
    await sleep(160);
    if (isTypeahead) await typeQuery(el, value);

    // Up to ~2.5s: a search-backed list shows "Loading…" before its options.
    let { popup, options, target } = await waitForOption(el, value, 2500);

    // A place search often finds nothing for "Atlanta, Georgia" but plenty
    // for "Atlanta": search again on the first part and choose from that.
    const first = value.split(",")[0].trim();
    if (!target && isTypeahead && first.length >= 3 && first !== value.trim()) {
      await typeQuery(el, first);
      ({ popup, options, target } = await waitForOption(el, value, 2500));
    }

    if (!popup) {
      if (isTypeahead) {
        // The text is in the field even without a menu; verification decides.
        fire(el, "change");
        el.blur?.();
        return { ok: true, note: "typed without a suggestion list" };
      }
      press(el); // close whatever we opened
      return { ok: false, reason: "Dropdown did not open" };
    }

    if (!target) {
      const available = options
        .slice(0, 8)
        .map((o) => cleanText(o.textContent))
        .filter(Boolean);
      if (isTypeahead) {
        fire(el, "change");
        el.blur?.();
        await sleep(120);
        // A free-text typeahead keeps what was typed. A pick-only one
        // (react-select) empties it — say plainly that there was no such option.
        if (norm(window.__screenmateScan.currentValue(el))) {
          return { ok: true, note: "typed; no exact suggestion offered" };
        }
        return { ok: false, reason: `No option "${value}" in this list` };
      }
      press(el);
      return {
        ok: false,
        reason: `No option "${value}"${available.length ? ` — offered: ${available.join(", ")}` : ""}`,
      };
    }

    target.scrollIntoView?.({ block: "nearest" });
    press(target);
    await sleep(160);
    if (isTypeahead) el.blur?.();
    return { ok: true, chosen: optionText(target) };
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

      if (el.disabled || el.readOnly || el.getAttribute("aria-disabled") === "true")
        return { ok: false, reason: "The field is disabled or read-only" };
      if ((tag === "input" || tag === "textarea") && el.maxLength >= 0 && String(value).length > el.maxLength)
        return { ok: false, reason: `This field allows at most ${el.maxLength} characters. Shorten the answer.` };
      if (field.multiple && tag !== "select" && !isCheckboxGroup(el))
        return { ok: false, reason: "Choose these multiple options directly on the page, then confirm the answer." };

      if (type === "file") return { ok: false, reason: "An upload takes a file, not text" };
      if (type === "radio") return writeRadio(el, value);
      if (type === "checkbox") {
        return isCheckboxGroup(el) ? writeCheckboxGroup(el, value) : writeCheckbox(el, value);
      }
      if (role === "radiogroup") return writeAriaRadioGroup(el, value);
      if (role === "checkbox" || role === "switch") return writeAriaCheckbox(el, value);
      if (tag === "select") return writeSelect(el, value);
      if (role === "combobox" || role === "listbox" || el.getAttribute("aria-haspopup") === "listbox") return writeCombobox(el, value);
      if (el.isContentEditable) return writeContentEditable(el, value);
      return await writeText(el, value);
    } catch (err) {
      return { ok: false, reason: err?.message || "Write threw" };
    }
  }

  /**
   * Puts a file into an upload field, as if you had picked it in the site's
   * own dialog. The file comes from your saved resume or from a file you
   * chose in the panel; the site then does with it whatever its own picker
   * would. Reports success only once the page holds it.
   */
  async function attachFile(field, file) {
    const el = field?.el;
    if (!el?.isConnected || (el.type || "").toLowerCase() !== "file") {
      return { ok: false, reason: "This is not an upload field" };
    }
    if (el.disabled) return { ok: false, reason: "The upload field is disabled" };
    const accepted = String(el.accept || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    if (accepted.length && !accepted.some(rule => rule.startsWith(".")
      ? file.name.toLowerCase().endsWith(rule)
      : rule.endsWith("/*") ? file.type.toLowerCase().startsWith(rule.slice(0, -1))
      : file.type.toLowerCase() === rule)) {
      return { ok: false, reason: `This upload accepts ${el.accept}. Choose a matching file.` };
    }
    try {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      el.files = transfer.files;
      fire(el, "input", "change");
      for (let i = 0; i < 10; i++) {
        await sleep(150);
        if (el.getAttribute("aria-invalid") === "true") return { ok: false, reason: "The site rejected this file. Check its upload message." };
        if (el.files?.length && el.files[0].name === file.name) return { ok: true, chosen: file.name };
        // Some sites take the file into their own state and clear the input;
        // the file's name on the page is then the proof it landed.
        const around = el.closest("form, [class*=field], [class*=Field], [class*=upload], [class*=Upload]");
        if (around?.textContent.includes(file.name)) return { ok: true, chosen: file.name };
      }
      return { ok: false, reason: "The site did not take the file" };
    } catch (err) {
      return { ok: false, reason: err?.message || "Attaching the file failed" };
    }
  }

  const digits = (s) => String(s || "").replace(/\D/g, "");
  /** A phone number, however the site formats it back: "+1 (404) 555-0199". */
  const phoneLike = (s) => /^[+()\d\s.\-]{7,}$/.test(String(s || "").trim()) && digits(s).length >= 7;

  /**
   * Re-reads the DOM after a write. Deliberately independent of what applyWrite
   * reported: we check the page, not our own optimism.
   */
  function verifyWrite(field, expected) {
    const el = field.el;
    const checks = [];

    checks.push({ label: "Element still in page", ok: Boolean(el?.isConnected) });

    const actual = el?.isConnected ? window.__screenmateScan.currentValue(el) : "";
    const type = (el?.type || "").toLowerCase();
    const role = (el?.getAttribute?.("role") || "").toLowerCase();
    const singleBox =
      (type === "checkbox" && !isCheckboxGroup(el)) || role === "checkbox" || role === "switch";
    const group = (type === "checkbox" && isCheckboxGroup(el)) || field.multiple;

    let committed;
    let expectsValue = Boolean(norm(expected));
    if (singleBox) {
      // Ticked or not is the whole answer; "Unchecked" reads back as empty.
      expectsValue = isTick(expected);
      committed = Boolean(norm(actual)) === expectsValue;
    } else if (group) {
      const sep = new RegExp(`\\s*${MULTI_SEPARATOR.trim()}\\s*`);
      const a = new Set(norm(actual).split(sep).filter(Boolean));
      const e = new Set(norm(expected).split(sep).filter(Boolean));
      committed = a.size === e.size && [...e].every((x) => a.has(x));
    } else if ((type === "tel" || /phone|mobile|telephone/i.test(field.label || "")) && phoneLike(expected)) {
      // Phone widgets reformat and add the country code.
      const a = digits(actual);
      const e = digits(expected);
      committed = a === e || (e.length === 10 && a === `1${e}`) || (a.length === 10 && e === `1${a}`);
    } else {
      // Custom widgets often render a decorated label ("No — I do not
      // require…"), so a prefix match is the honest bar for them.
      const a = norm(actual);
      const e = norm(expected);
      const exact = a === e;
      const choiceWidget = field.type === "select" || role === "combobox" || role === "listbox";
      const loose = choiceWidget && a.length >= 2 && e.length >= 2 &&
        ((a.startsWith(e) && !/[a-z0-9]/i.test(a.charAt(e.length))) ||
         (e.startsWith(a) && !/[a-z0-9]/i.test(e.charAt(a.length))));
      // A dropdown may show a short form of the option it chose: Greenhouse's
      // phone-country picker shows "+1" for "United States +1".
      const shortForm =
        (role === "combobox" || role === "listbox" || el?.getAttribute?.("aria-haspopup") === "listbox") &&
        a.length >= 2 &&
        new RegExp(`(^|[^a-z0-9])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`).test(e);
      committed = exact || loose || shortForm;
    }
    checks.push({ label: "Value committed to the DOM", ok: committed });

    checks.push({
      label: expectsValue ? "Field reports non-empty" : "Field left empty",
      ok: expectsValue ? norm(actual).length > 0 : true,
    });

    const invalid =
      el?.getAttribute?.("aria-invalid") === "true" ||
      (typeof el?.checkValidity === "function" && !el.checkValidity() && expectsValue);
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

  /**
   * verifyWrite, with the page given a moment to settle. React forms re-render
   * the chosen value and re-run validation a beat after the write; a check
   * taken too early reports a failure that is not there. A control the site
   * re-rendered is found again by its id first.
   */
  async function verifySettled(field, expected, { timeout = 1000 } = {}) {
    const refind = () => {
      if (field.el?.isConnected) return;
      const again = window.__screenmateScan.scanFields().find((f) => f.id === field.id);
      if (again) field.el = again.el;
    };
    refind();
    let result = verifyWrite(field, expected);
    let stableFor = 0;
    for (let waited = 0; waited < timeout; waited += 150) {
      await sleep(150);
      refind();
      result = verifyWrite(field, expected);
      stableFor = result.ok ? stableFor + 150 : 0;
      if (stableFor >= 300) return result;
    }
    return result;
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
   * you write a wrong answer into a protected field. `limit` is higher when you
   * are about to choose from the list yourself: a country list runs to 250.
   */
  async function readOptions(field, { limit = 60 } = {}) {
    const el = field?.el;
    if (!el?.isConnected) return [];
    const role = (el.getAttribute("role") || "").toLowerCase();
    if (role !== "combobox" && role !== "listbox" && el.getAttribute("aria-haspopup") !== "listbox") return field.options || [];

    const wasOpen = el.getAttribute("aria-expanded") === "true";
    const isTypeahead = isTypeaheadInput(el);
    const restore = isTypeahead ? el.value : null;

    if (!wasOpen) {
      focusQuietly(el);
      // react-select opens on a press; a type-to-open list on empty input.
      press(el);
      if (isTypeahead) {
        nativeSetter(el, "");
        fire(el, "input");
      }
      await sleep(200);
    }

    let options = [];
    for (let i = 0; i < 6 && !options.length; i++) {
      await sleep(i ? 120 : 180);
      const popup = findPopup(el);
      const nodes = popup ? Array.from(popup.querySelectorAll("[role=option], li")) : [];
      options = nodes
        .filter((o) => !nodes.some((p) => p !== o && o.contains(p)))
        .map(optionText)
        .filter((t) => t && !/^(loading|no options|no results)/i.test(t) &&
          !window.__screenmateScan.isPlaceholderOption({textContent:t,index:1,value:t}))
        .slice(0, limit);
    }

    if (isTypeahead) {
      // Put back whatever the user had typed before we probed, and close.
      nativeSetter(el, restore || "");
      fire(el, "input");
      if (!wasOpen) dismiss(el);
    } else if (!wasOpen && el.getAttribute("aria-expanded") === "true") {
      press(el);
    }
    await sleep(80);
    return options;
  }

  window.__screenmateAct = {
    directProfileValue,
    profileSuggestionValue: (field, profile) => directProfileValue(field, profile, true),
    applyWrite,
    attachFile,
    verifyWrite,
    verifySettled,
    highlight,
    focusQuietly,
    readOptions,
    optionScore,
    bestOption,
    splitMulti,
  };

  // Exact applicant labels can be transcribed immediately. Ambiguous wording,
  // personal declarations and generated answers still go through the normal flow.
  function directProfileValue(field, profile, allowSensitiveSuggestion = false) {
    if ((!allowSensitiveSuggestion && (field.sensitive || !["safe", "review"].includes(field.level))) || field.type === "textarea" || field.type === "file" || field.multiple) return null;
    const section = field.el?.closest?.('fieldset, section');
    const heading = section?.querySelector?.('legend, h2, h3, h4')?.textContent || "";
    if (/reference|referee|emergency|supervisor|manager|spouse|dependent/i.test(heading)) return null;
    const label = norm(field.label).replace(/\s*\((?:required|optional)\)\s*$/i, "").replace(/[*:]+$/g, "").trim();
    const labels = {
      'name':'name', 'full name':'name', 'full legal name':'name',
      'first name':'firstName', 'given name':'firstName', 'last name':'lastName', 'family name':'lastName', 'surname':'lastName',
      'email':'email', 'email address':'email', 'e-mail address':'email',
      'phone':'phone', 'phone number':'phone', 'mobile number':'phone',
      'telephone':'phone', 'telephone number':'phone', 'mobile phone':'phone',
      'location':'location', 'current location':'location', 'city and state':'location', 'location (city)':'city',
      '(city, country)':'locationWithCountry', 'city, country':'locationWithCountry',
      'city and country':'locationWithCountry',
      'country':'country', 'country of residence':'country',
      'city':'city', 'state':'state', 'province':'state', 'state / province':'state',
      'postal code':'postalCode', 'zip code':'postalCode', 'zip':'postalCode',
      'street address':'address', 'address line 1':'address', 'address line 2':'addressLine2',
      'university':'university', 'school or university':'university',
      'school':'university', 'college':'university', 'college or university':'university',
      'degree':'degree', 'highest degree attained':'degree', 'education level':'degree',
      'graduation year':'graduationDate', 'graduation date':'graduationDate',
      'portfolio':'portfolio', 'portfolio url':'portfolio', 'portfolio or website':'portfolio',
      'linkedin':'linkedin', 'linkedin profile':'linkedin', 'linkedin url':'linkedin',
      'linkedin profile url':'linkedin', 'website':'portfolio', 'personal website':'portfolio',
      'github':'github', 'github profile':'github',
      'current company':'currentCompany', 'current employer':'currentCompany', 'current title':'currentTitle',
    };
    const key = labels[label];
    const locationWithCountry = () => {
      const location = typeof profile?.location === 'string' ? profile.location.trim() : '';
      const country = typeof profile?.country === 'string' ? profile.country.trim() : '';
      if (!location || !country) return '';
      const withoutCountry = location.replace(new RegExp(`[,\\s]+${country}$`, 'i'), '');
      return `${withoutCountry}, ${country}`;
    };
    const value = key === 'city'
      ? profile?.city || (typeof profile?.location === 'string' ? profile.location.split(',')[0].trim() : '')
      : key === 'locationWithCountry'
        ? locationWithCountry()
        : key && profile?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if ((key === 'firstName' || key === 'lastName') && typeof profile?.name === 'string') {
      const parts = profile.name.trim().split(/\s+/);
      if (parts.length > 1) return key === 'firstName' ? parts[0] : parts[parts.length - 1];
    }
    return null;
  }
})();
