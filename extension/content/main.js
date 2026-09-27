/**
 * Orchestration across a multi-step application.
 *
 *   per page:  observe → classify → plan → research → act → verify → approve
 *   between:   validate → find "Next" → advance → repeat
 *   at the end: hand the submit button back to the user, always
 *
 * The per-page loop is the same one the web app runs. The page loop around it is
 * what makes this work on a real wizard.
 */

(() => {
  if (window.__screenmateLoaded) return;
  window.__screenmateLoaded = true;

  // Just enough for a framework to settle between writes; any longer is only
  // waiting for its own sake.
  const MAX_STEPS = 8;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const EMPTY_STATS = () => ({
    safeFields: 0,
    reviewedSuggestions: 0,
    userDecisions: 0,
    verifiedActions: 0,
    sourcesUsed: 0,
    pagesCompleted: 0,
  });

  const S = {
    panel: null,
    gen: 0,
    running: false,
    status: "idle",
    context: {},
    fields: [],
    goal: null,
    steps: [],
    activity: [],
    research: null,
    approvalQueue: [],
    /** True while collecting unresolved answers before writes on this page. */
    preflightReview: false,
    changes: [],
    report: null,
    banner: null,
    profile: null,
    step: 1,
    pages: [],
    observedSig: null,
    lastObservationLog: null,
    submitHandoff: null,
    prefs: {},
    needsPrefs: false,
    /** Sensitive fields already settled this run — prevents re-asking forever. */
    resolvedSensitive: new Set(),
    /** "fieldId::value" writes that already failed this run — never retried. */
    failedWrites: new Set(),
    /** Fields already reported as flagged or ungrounded, so later passes stay quiet. */
    noted: new Set(),
    /** Fields the agent has acted on or ruled out on this step, and its passes so far. */
    addressed: new Set(),
    passes: 0,
    /** What the site said after you confirmed Submit, once it has said it. */
    submitted: null,
    /** True while your answer is being written, so a second click cannot land twice. */
    answering: false,
    /** Fields the site filled from its own reading of your resume; the agent may correct them. */
    siteFilled: new Set(),
    /** Why the agent handed a question back, in its own words. */
    flagReasons: new Map(),
    /** You closed the panel on this address: it does not pop back by itself. */
    dismissedAt: null,
    stats: EMPTY_STATS(),
  };

  /* ---------------- plumbing ---------------- */

  /** Said when the extension was updated or reloaded under an open page. */
  const ORPHANED = {
    ok: false,
    error: "SCREENMATE was updated",
    reason: "Reload this page to keep using it.",
  };

  const api = (route, body) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "screenmate:api", route, body }, (r) => {
          void chrome.runtime.lastError;
          resolve(r || (chrome.runtime?.id ? { ok: false, error: "Extension messaging failed" } : ORPHANED));
        });
      } catch {
        resolve(ORPHANED);
      }
    });

  function log(kind, message, detail, nested = false) {
    S.activity.push({ kind, message, detail, nested });
    paint(true);
  }

  function counts() {
    const filled = S.fields.filter((f) => f.value && f.value.trim()).length;
    return {
      total: S.fields.length,
      filled,
      sensitive: S.fields.filter((f) => f.level === "sensitive").length,
      review: S.fields.filter((f) => f.level === "review").length,
    };
  }

  let paintQueued = false;
  let scrollQueued = false;
  function paint(autoscroll = false) {
    scrollQueued ||= autoscroll;
    if (paintQueued) return;
    paintQueued = true;
    requestAnimationFrame(() => {
      paintQueued = false;
      const scroll = scrollQueued;
      scrollQueued = false;
      renderPanel(scroll);
    });
  }

  function renderPanel(autoscroll = false) {
    S.panel?.render({
      context: S.context,
      status: S.status,
      goal: S.goal,
      steps: S.steps,
      activity: S.activity.slice(-60),
      research: S.research,
      approval: S.approvalQueue[0] || null,
      approvalCount: S.approvalQueue.length,
      approvals: S.approvalQueue,
      preflightReview: S.preflightReview,
      changes: S.changes,
      report: S.report,
      stats: S.stats,
      banner: S.banner,
      counts: S.fields.length ? counts() : null,
      step: S.step,
      pages: S.pages,
      submitHandoff: S.submitHandoff,
      submitted: S.submitted,
      needsPrefs: S.needsPrefs,
      needsProfile: S.needsProfile,
      prefs: S.prefs,
      prefQuestions: window.__screenmatePrefs.QUESTIONS,
      autoscroll,
    });
  }

  const setStatus = (s) => {
    S.status = s;
    paint();
  };
  const stale = (gen) => S.gen !== gen;

  function markStep(kind, status) {
    const step = S.steps.find(
      (s) => s.kind === kind && s.status !== "done" && s.status !== "skipped",
    );
    if (step) {
      step.status = status;
      paint();
    }
  }

  /* ---------------- observe ---------------- */

  /**
   * Rescans the DOM and re-classifies through the backend. Classification is the
   * ONLY source of policy levels — if it fails we fail closed and touch nothing.
   */
  const classificationCache = new Map();
  async function observe() {
    const scanned = window.__screenmateScan.scanFields();
    const fresh = window.__screenmateScan.pageContext();
    // Past step 1 a wizard's page often drops the posting itself; keep what
    // the first step said about the job, and take only where we are now.
    S.context =
      S.step > 1 && S.context?.company
        ? { ...S.context, stepLabel: fresh.stepLabel, url: fresh.url }
        : fresh;

    if (scanned.length === 0) {
      S.fields = [];
      S.banner = "No supported form fields found. If the page is still loading, wait for the questions to appear and try again.";
      setStatus("error");
      log("warn", "No form fields on this step", S.banner);
      return false;
    }

    const descriptors = scanned.map((f) => ({
        id: f.id,
        label: f.label,
        type: f.type,
        required: f.required,
        options: f.options,
      }));
    const cacheKey = JSON.stringify(descriptors);
    const res = classificationCache.get(cacheKey) || await api("classify", { fields: descriptors });
    if (res.ok) {
      if (classificationCache.size >= 8) classificationCache.delete(classificationCache.keys().next().value);
      classificationCache.set(cacheKey, res);
    }

    if (!res.ok) {
      S.fields = [];
      S.banner = `${res.error}${res.reason ? ` — ${res.reason}` : ""}`;
      log("warn", "Cannot classify fields — standing down", res.reason || res.error);
      setStatus("error");
      return false;
    }

    // Live element handles never leave the content script.
    const byId = new Map(scanned.map((f) => [f.id, f]));
    S.fields = res.data.fields.map((f) => ({
      ...f,
      el: byId.get(f.id)?.el,
      value: byId.get(f.id)?.value || "",
      multiple: byId.get(f.id)?.multiple,
    }));

    // Opening the panel observes, and so does the start of a run. Re-reading is
    // correct — the page may have changed — but saying so twice is not.
    const signature = `${S.step}:${S.fields.map((f) => f.id).join(",")}`;
    if (signature !== S.lastObservationLog) {
      S.lastObservationLog = signature;
      const c = counts();
      log(
        "observe",
        `Step ${S.step} analyzed${S.context.stepLabel ? ` · ${S.context.stepLabel}` : ""}`,
        `${c.total} fields · ${c.total - c.filled} open · ${c.sensitive} sensitive`,
      );
    }
    return true;
  }

  /* ---------------- agent payload ---------------- */

  function payload(phase, extra = {}) {
    return {
      phase,
      applicationState: {
        jobTitle: S.context.jobTitle || "this role",
        company: S.context.company || "this company",
        jobDescription: S.context.jobDescription || "",
        fields: S.fields.map((f) => ({
          id: f.id,
          label: f.label,
          type: f.type,
          section: "role",
          value: f.value || null,
          required: f.required,
          sensitive: f.sensitive,
          level: f.level,
          options: f.options,
        })),
        completedFields: counts().filled,
        totalFields: S.fields.length,
        validationErrors: [],
      },
      profile: S.profile,
      research: S.research
        ? {
            companySummary: S.research.companySummary,
            technicalFocus: S.research.technicalFocus,
            relevantContext: S.research.relevantContext,
            sourceCount: S.research.sources.length,
          }
        : null,
      recentActions: S.changes.map((c) => `filled ${c.fieldId}`).slice(-20),
      ...extra,
    };
  }

  function failAgent(res) {
    S.banner = `${res.error}${res.reason ? ` — ${res.reason}` : ""}`;
    log("warn", res.error, res.reason);
    setStatus("error");
  }

  /* ---------------- research ---------------- */

  // Trimmed to the route's limits: a real posting URL is routinely longer than
  // roleId's 60 characters, and one over-long field fails the request.
  const researchRequest = () =>
    api("research", {
      company: (S.context.company || "this company").slice(0, 120),
      role: (S.context.jobTitle || "this role").slice(0, 120),
      roleId: (S.context.url || "").slice(0, 60),
    });

  /** `pending` is a request already started alongside the plan, if any. */
  async function runResearch(pending) {
    if (S.research) {
      log("think", "Research reused", "Context for this company is already loaded.");
      markStep("research", "done");
      return;
    }
    setStatus("researching");
    markStep("research", "active");
    const res = await (pending || researchRequest());
    if (!res.ok) {
      log("warn", "External research unavailable", "Continuing without it.");
      markStep("research", "skipped");
      return;
    }
    S.research = res.data;
    S.stats.sourcesUsed += res.data.sources.length;
    log(
      "success",
      "Company context retrieved",
      `${res.data.sources.length} sources${
        res.data.technicalFocus?.length
          ? ` · ${res.data.technicalFocus.slice(0, 3).join(", ")}`
          : ""
      }`,
    );
    markStep("research", "done");
  }

  /* ---------------- act + verify ---------------- */

  /**
   * A native select's whole list, not the 60 sent to the server: "United
   * States" is rarely among the first 60 countries. Null for other widgets.
   */
  const nativeOptions = (el) =>
    el?.tagName === "SELECT"
      ? Array.from(el.options)
          .filter((o) => !window.__screenmateScan.isPlaceholderOption(o))
          .map((o) => window.__screenmateScan.cleanText(o.textContent))
          .filter(Boolean)
      : null;

  /** Memory key for an answer you gave a question that has no standing topic. */
  const preferenceKey = field => window.__screenmatePrefs.keyFor(field);

  /** A resume upload, as opposed to a cover letter or a portfolio file. */
  const isResumeField = (field) =>
    field.type === "file" && /resume|résumé|\bcv\b|curriculum/i.test(field.label) && !/cover/i.test(field.label);

  /** Your saved resume as a File, or null. Read from storage once per page. */
  let resumeCache;
  async function savedResume() {
    if (resumeCache !== undefined) return resumeCache;
    resumeCache = null;
    try {
      const { resumeFile } = await chrome.storage.local.get("resumeFile");
      if (resumeFile?.data) {
        const bytes = Uint8Array.from(atob(resumeFile.data), (c) => c.charCodeAt(0));
        resumeCache = new File([bytes], resumeFile.name, {
          type: resumeFile.type || "application/octet-stream",
          lastModified: resumeFile.savedAt ? Date.parse(resumeFile.savedAt) || Date.now() : Date.now(),
        });
      }
    } catch {
      /* no saved resume is the ordinary case */
    }
    return resumeCache;
  }

  /**
   * Queues a question for you. `kind` is "decision" (a sensitive question),
   * "missing" (required, and your profile does not cover it) or "flagged" (it
   * asks about your own experience).
   */
  async function queueApproval(field, reason, kind = "decision") {
    if (!window.__screenmatePrefs.shouldAsk(field, S.prefs)) {
      if (!S.noted.has(`optional:${field.id}`)) {
        S.noted.add(`optional:${field.id}`);
        log("observe", `${field.label} left blank`, "Optional and no saved answer. Continuing with the application.");
      }
      return;
    }
    if (S.resolvedSensitive.has(field.id)) return;
    if (S.approvalQueue.some((a) => a.fieldId === field.id)) return;

    // An upload is yours to attach. You pick the file in the panel (or use
    // your saved resume) and it goes into this site's upload field, exactly
    // as if you had used the site's own button.
    if (field.type === "file") {
      const resume = isResumeField(field) ? await savedResume() : null;
      S.approvalQueue.push({
        fieldId: field.id,
        label: field.label,
        required: field.required,
        reason: resume
          ? `Attach your saved resume (${resume.name}), or choose a different file.`
          : "Choose the file to attach. It goes from your computer to this site, the same as the site's own button.",
        options: null,
        topic: null,
        free: false,
        kind: "file",
        savedResume: resume?.name || null,
      });
      return;
    }

    let options = null;
    let free = true;
    if (field.type === "select") {
      // Never guess. Read the widget's real choices, so we cannot offer
      // "Yes/No" on a question whose answers are nothing of the kind.
      const native = nativeOptions(field.el);
      options = native?.length
        ? native
        : field.options?.length && !(field.options.length >= 60)
          ? field.options
          : await window.__screenmateAct.readOptions(field, { limit: 400 });
      // A list that stopped at the limit may be cut short; typing finds the rest.
      free = !options || options.length === 0 || (!native && options.length >= 400);
      if (!free && options.length <= 60) field.options = options;
    }

    // The agent can hand back a question that is not sensitive at all (it
    // could not answer it from your profile): that is a missing answer, not a
    // decision only you may make.
    const shownKind = kind === "decision" && !field.sensitive ? "missing" : kind;

    S.approvalQueue.push({
      fieldId: field.id,
      label: field.label,
      required: field.required,
      reason: field.sensitiveReason || reason || "",
      suggestedValue: field.sensitive
        ? window.__screenmateAct.profileSuggestionValue(field, S.profile) || ""
        : "",
      options: free ? null : options,
      // An essay that merely mentions a topic word ("a race condition you
      // debugged") must not be remembered as your answer for that topic, and
      // an essay is never worth remembering. Anything else can be.
      topic: field.type === "textarea" ? null : preferenceKey(field),
      free,
      kind: shownKind,
      multiple: Boolean(field.multiple) && !free,
      multiline: field.type === "textarea",
    });
  }

  /**
   * Attaches your saved resume to this step's resume upload, before anything
   * else is filled: some sites (Lever) read the file and fill fields from it,
   * and that should happen first, not overwrite the agent's work.
   */
  async function attachSavedResume(gen) {
    const { settings } = await chrome.storage.local.get("settings").catch(() => ({}));
    if (settings?.autoAttachResume === false) return 0;
    const targets = S.fields.filter(
      (f) => isResumeField(f) && isOpen(f) && !S.resolvedSensitive.has(f.id),
    );
    if (!targets.length) return 0;
    const file = await savedResume();
    if (!file) return 0;

    const before = new Map(S.fields.map((f) => [f.id, (f.value || "").trim()]));
    let attached = 0;
    for (const field of targets) {
      if (stale(gen)) return attached;
      const res = await window.__screenmateAct.attachFile(field, file);
      if (!res.ok) {
        log("warn", `Could not attach your resume to ${field.label}`, `${res.reason} — you'll be asked instead.`);
        continue;
      }
      attached += 1;
      field.value = window.__screenmateScan.currentValue(field.el) || `1 file selected`;
      S.resolvedSensitive.add(field.id);
      S.stats.userDecisions += 1;
      S.changes.push({
        fieldId: field.id,
        label: field.label,
        before: "",
        after: file.name,
        verified: true,
        level: field.level,
        step: S.step,
        fromPreference: true,
        regenerable: false,
        file: true,
      });
      window.__screenmateAct.highlight(
        field.el.closest("[class*=field], [class*=upload], [class*=Upload], li") || field.el,
      );
      log("prefs", `${field.label}: your saved resume attached`, `"${file.name}" — the file you saved in SCREENMATE.`);
    }
    if (attached) {
      // A site that reads the resume fills fields from it; give it a moment
      // and re-read the page, so the agent works on what is really there.
      await sleep(1500);
      for (const f of S.fields) {
        if (f.el?.isConnected) f.value = window.__screenmateScan.currentValue(f.el);
        // Filled by the site's own reading of the file, not by you: the agent
        // may put your profile's value there if the site read it wrong.
        if (!before.get(f.id) && (f.value || "").trim() && f.type !== "file") S.siteFilled.add(f.id);
      }
      if (S.siteFilled.size) {
        log(
          "observe",
          `The site read your resume and filled ${S.siteFilled.size} field${S.siteFilled.size === 1 ? "" : "s"}`,
          "SCREENMATE checks them against your profile.",
        );
      }
    }
    return attached;
  }

  /**
   * Before a step is left, everything required that is still empty, and every
   * question the agent handed back, is asked of you, so nothing is quietly
   * skipped. Returns true when a question is now waiting.
   */
  async function askForMissing() {
    for (const f of S.fields) {
      if (!isOpen(f) || S.resolvedSensitive.has(f.id)) continue;
      if (S.approvalQueue.some((a) => a.fieldId === f.id)) continue;
      const flagged = S.noted.has(`flag:${f.id}`);
      // Optional gaps never interrupt unless the applicant chose Ask each time.
      if (!window.__screenmatePrefs.shouldAsk(f, S.prefs)) continue;
      const kind = f.sensitive ? "decision" : flagged ? "flagged" : "missing";
      // The agent's own words for why it handed this back, when it said.
      const said = S.flagReasons.get(f.id);
      const reason =
        kind === "flagged"
          ? said
            ? `${said.replace(/\.?\s*$/, ".")} Answer it here and it goes straight into the form.`
            : "It asks about your own experience, so SCREENMATE won't invent an answer. Write it here and it goes straight into the form."
          : "Your profile doesn't cover this. Answer it here and SCREENMATE puts it in the form.";
      await queueApproval(f, reason, kind);
      if (kind !== "decision") log("lock", `${f.label} needs your answer`, reason);
      else log("lock", `${f.label} requires user input`, f.sensitiveReason);
    }
    if (!S.approvalQueue.length) return false;
    markStep("approval", "active");
    setStatus("waiting");
    return true;
  }

  /** Gather every answer the agent cannot safely supply before any page write. */
  async function collectPreflightQuestions() {
    const { settings = {} } = await chrome.storage.local.get("settings").catch(() => ({}));
    const canAttachResume = settings.autoAttachResume !== false && Boolean(await savedResume());
    const experience = String(S.profile?.experience || S.profile?.projects || "").trim();

    for (const field of S.fields) {
      if (!isOpen(field) || S.resolvedSensitive.has(field.id)) continue;
      const stored = window.__screenmatePrefs.storedFor(field, S.prefs);
      const hasStandingAnswer = stored && stored !== window.__screenmatePrefs.ASK && field.type !== "textarea";
      const direct = window.__screenmateAct.directProfileValue(field, S.profile);
      const isFile = field.type === "file" || isResumeField(field);
      if (hasStandingAnswer || (direct && !field.sensitive) || (isFile && canAttachResume)) continue;

      const asksForPastWork = /\b(describe|tell us about|share|explain)\b.{0,100}\b(experience|project|accomplishment|achievement|work you|work that)\b/i.test(field.label);
      // Verification and anti-bot codes cannot be researched or generated on
      // the applicant's behalf. Surface these with the rest of preflight.
      const asksForVerificationCode =
        /\b(?:application|verification|security|access|confirmation)\s+code\b|\bcode\b.{0,100}\b(?:console|captcha|robot|verification)\b/i.test(field.label);
      const missingExperience = field.type === "textarea" && asksForPastWork && !experience;
      const shouldAsk = field.required || window.__screenmatePrefs.shouldAsk(field, S.prefs);
      if (!shouldAsk || (field.type === "textarea" && !missingExperience && !asksForVerificationCode)) continue;

      const reason = missingExperience
        ? "This asks about your own past work, and your saved profile has no details to ground an answer."
        : asksForVerificationCode
          ? "This is a site-specific verification or anti-bot code. SCREENMATE won't retrieve or guess it; review it here if you choose to provide it."
        : field.sensitiveReason || "Your profile doesn't cover this. Review it before SCREENMATE fills the rest of the form.";
      await queueApproval(field, reason, field.sensitive ? "decision" : missingExperience ? "flagged" : "missing");
    }

    if (!S.approvalQueue.length) return false;
    S.preflightReview = true;
    markStep("approval", "active");
    log("lock", "Review missing information first", `${S.approvalQueue.length} item${S.approvalQueue.length === 1 ? "" : "s"} need your answer or approval before autofill starts.`);
    setStatus("waiting");
    return true;
  }

  /**
   * Fills every sensitive field on this step that the user already has a
   * standing answer for. Returns the count handled.
   *
   * These are still the user's decisions — we log them as such — but they were
   * made once, up front, instead of interrupting every run.
   */
  async function applyPreferences(gen) {
    let handled = 0;
    for (const field of S.fields) {
      if (stale(gen)) return handled;
      // A standing-answer topic the policy recognised (sensitive or not), or a
      // question you answered before and asked to have remembered.
      const key = preferenceKey(field);
      if (!key) continue;
      if ((field.value || "").trim()) continue;
      if (S.resolvedSensitive.has(field.id)) continue;
      const stored = window.__screenmatePrefs.storedFor(field, S.prefs, key);
      const usable = stored && stored !== window.__screenmatePrefs.ASK && field.type !== "textarea";
      if (!usable) continue;

      // Resolve against the widget's real choices, not a guess.
      if (field.type === "select" && !field.options?.length) {
        const discovered = await window.__screenmateAct.readOptions(field);
        if (discovered.length) field.options = discovered;
      }
      // Match against a native select's whole list, not the truncated one.
      const full = nativeOptions(field.el);
      let hit = window.__screenmatePrefs.resolve(
        full?.length ? { ...field, options: full } : field,
        S.prefs,
        key,
      );
      // Several ticked options, remembered together.
      if (!hit && usable && field.multiple) {
        const picks = window.__screenmateAct.splitMulti(stored, field.options || []);
        if (picks.length) hit = { value: picks.join(window.__screenmateScan.MULTI_SEPARATOR) };
      }
      // A long searchable list (countries, schools) is only read to 60
      // entries; the widget's own search finds your answer past that.
      const role = field.el?.getAttribute?.("role");
      if (!hit && usable && (role === "combobox" || role === "listbox") && (field.options?.length || 0) >= 60) {
        hit = { value: stored };
      }
      if (!hit) continue;

      const res = await window.__screenmateAct.applyWrite(field, hit.value);
      if (!res.ok) {
        log(
          "warn",
          `Your saved answer does not fit ${field.label}`,
          `${res.reason} — handing it to you.`,
        );
        await queueApproval(field, "Your standing answer had no match here.");
        continue;
      }
      const landed = res.chosen || hit.value;
      // Wait out the widget before re-reading: a dropdown commits its choice
      // a beat after the click.
      const check = await window.__screenmateAct.verifySettled(field, landed);
      if (stale(gen)) return handled;
      if (!check.ok) {
        // Never report an answer the page does not actually hold.
        log(
          "warn",
          `Your saved answer did not stick on ${field.label}`,
          `${check.summary} — handing it to you.`,
        );
        await queueApproval(field, "Your standing answer could not be set on this control.");
        continue;
      }
      window.__screenmateAct.highlight(field.el);
      field.value = check.actual;
      S.resolvedSensitive.add(field.id);
      S.approvalQueue = S.approvalQueue.filter(q => q.fieldId !== field.id);
      S.stats.userDecisions += 1;
      S.stats.verifiedActions += 1;

      S.changes.push({
        fieldId: field.id,
        label: field.label,
        before: "",
        after: landed,
        verified: true,
        level: field.level,
        step: S.step,
        fromPreference: true,
        // Lets Edit offer the real choices instead of a free-text box.
        options: field.type === "select" ? field.options : undefined,
      });

      log(
        "prefs",
        `${field.label} answered from your saved preference`,
        `"${landed}" — your standing answer, not the agent's judgement.`,
      );
      handled += 1;      if (stale(gen)) return handled;
    }
    return handled;
  }

  async function applyAction(action, gen) {
    const field = S.fields.find((f) => f.id === action.args?.fieldId);
    if (!field) {
      log("warn", `Unknown field "${action.args?.fieldId}" ignored`);
      return;
    }

    // A question the agent should not answer for you, most often one asking
    // about experience your profile does not describe. Say so once.
    if (action.tool === "flagIssue") {
      // Already answered on the page: there is nothing left to hand back.
      if (!isOpen(field)) return;
      if (!S.noted.has(`flag:${field.id}`)) {
        S.noted.add(`flag:${field.id}`);
        if (action.args?.message) S.flagReasons.set(field.id, String(action.args.message).slice(0, 220));
        log("warn", `${field.label} needs you`, action.args?.message || "Left for you to answer.");
      }
      return;
    }

    if (action.tool === "requestUserApproval") {
      // Settled earlier in this run, or already answered on the page: the
      // model asking again is not news. An optional file other than a resume
      // (a cover letter) is not worth stopping the run for.
      if (S.resolvedSensitive.has(field.id) || !isOpen(field)) return;
      if (!window.__screenmatePrefs.shouldAsk(field, S.prefs)) {
        await queueApproval(field, action.args.reason);
        return;
      }
      await queueApproval(field, action.args.reason);
      if (field.sensitive) log("lock", `${field.label} requires user input`, field.sensitiveReason);
      else log("lock", `${field.label} needs your answer`, action.args.reason || "Your profile doesn't cover it.");
      markStep("approval", "active");
      return;
    }

    // Client-side backstop. The server already rewrites these; the tool layer
    // refuses independently — the same three-layer guarantee as the web app.
    if (field.sensitive) {
      if (!window.__screenmatePrefs.shouldAsk(field, S.prefs)) return;
      if (!S.resolvedSensitive.has(field.id)) {
        log("lock", `Blocked: ${field.label} is user-only`, "Requesting your decision.");
      }
      await queueApproval(field);
      return;
    }

    let value = (action.args?.value || "").trim();
    if (!value) return;
    // A link the server's prose cleanup split apart ("https: //github. com/x",
    // from a backend older than this extension) goes in whole or not at all.
    if (/^https?:\s+\/\/\S/i.test(value)) value = value.replace(/([:./])\s+(?=\S)/g, "$1");

    // A question the agent already said it cannot answer honestly stays
    // yours: a later pass does not get to change its mind and write one.
    if (S.noted.has(`flag:${field.id}`)) return;

    // Never over anything already there: your own answer, the site's, or a
    // value the agent wrote on an earlier pass. Read the page, not our notes.
    // The one exception is a field the site filled from its own reading of
    // your resume, where your profile's value is the one that counts.
    if (S.resolvedSensitive.has(field.id)) return;
    if (field.el?.isConnected) field.value = window.__screenmateScan.currentValue(field.el);
    const correcting =
      S.siteFilled.has(field.id) &&
      !S.changes.some((c) => c.fieldId === field.id) &&
      (field.value || "").trim().toLowerCase() !== value.toLowerCase();
    if (!isOpen(field) && !correcting) return;

    // The same write already failed this run; a second pass asking for it
    // again would only fail again, louder.
    const attempt = `${field.id}::${value}`;
    if (S.failedWrites.has(attempt)) return;

    const before = field.value || "";
    const written = await window.__screenmateAct.applyWrite(field, value);
    if (!written.ok) {
      S.failedWrites.add(attempt);
      log("warn", `Could not write ${field.label}`, written.reason);
      return;
    }
    // A suggestion menu may have put the site's own wording in the field
    // ("Atlanta, GA, USA"); that is what the page holds and what we check.
    let landed = written.chosen || value;
    window.__screenmateAct.highlight(field.el);
    log(
      "write",
      `${field.label} completed`,
      landed.length > 90 ? `${landed.slice(0, 89)}…` : landed,
    );

    setStatus("verifying");
    let check = await window.__screenmateAct.verifySettled(field, landed);
    if (stale(gen)) return;
    if (!check.ok) {
      log("warn", "Verification failed — retrying once", check.summary, true);
      const retry = await window.__screenmateAct.applyWrite(field, value);
      landed = retry.chosen || value;
      check = await window.__screenmateAct.verifySettled(field, landed);
    }

    field.value = check.actual;
    if (!check.ok) S.failedWrites.add(attempt);

    // A second pass that rewrites the same field updates its entry, keeping
    // the original value so a revert still restores what the page first held.
    const earlier = S.changes.find((c) => c.fieldId === field.id && c.step === S.step);
    if (check.ok && !earlier?.verified) S.stats.verifiedActions += 1;
    if (!earlier) {
      if (field.level === "review") S.stats.reviewedSuggestions += 1;
      else S.stats.safeFields += 1;
    }
    if (earlier) {
      Object.assign(earlier, { after: landed, verified: check.ok, level: field.level });
    } else {
      S.changes.push({
        fieldId: field.id,
        label: field.label,
        before,
        after: landed,
        verified: check.ok,
        level: field.level,
        step: S.step,
        options: field.type === "select" ? field.options : undefined,
      });
    }

    log(
      check.ok ? "verify" : "warn",
      check.ok ? "Field update confirmed" : `Verification failed — ${check.summary}`,
      check.checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.label}`).join("  ·  "),
      true,
    );
    setStatus("acting");
  }

  async function runPass(gen) {
    setStatus("planning");
    let res = await api("agent", payload("act"));
    // A model reply that failed validation, or a provider hiccup, usually
    // succeeds on a second try; a network or key problem does not.
    if (!res.ok && res.status >= 500 && !stale(gen)) {
      log("warn", "Agent reply was unusable, asking again", res.reason || res.error, true);
      res = await api("agent", payload("act"));
    }
    if (!res.ok) {
      failAgent(res);
      return "error";
    }
    if (stale(gen)) return "stale";

    const plan = res.data;
    S.passes += 1;
    log("think", "Decision", plan.decisionSummary);
    const droppedFields = (plan.dropped || [])
      .map((d) => S.fields.find((f) => String(d).startsWith(`${f.id}:`)))
      .filter(Boolean);
    // Everything the agent touched or was stopped on has had its turn.
    for (const a of plan.actions) if (a.args?.fieldId) S.addressed.add(a.args.fieldId);
    for (const f of droppedFields) S.addressed.add(f.id);
    // Name the fields, and only once: a later pass tends to retry the same ones.
    const dropped = droppedFields.filter((f) => !S.noted.has(`dropped:${f.id}`));
    if (dropped.length) {
      dropped.forEach((f) => S.noted.add(`dropped:${f.id}`));
      log(
        "warn",
        `${dropped.length} ungrounded write${dropped.length === 1 ? "" : "s"} discarded`,
        `${dropped.map((f) => f.label).join(" · ")} — the value was not in your profile, so it is left for you.`,
      );
    }

    setStatus("acting");
    markStep("fill", "active");
    for (const action of plan.actions) {      if (stale(gen)) return "stale";
      if (action.tool === "researchCompany") {
        await runResearch();
        continue;
      }
      // The page loop validates every step itself once the pass ends.
      if (action.tool === "validateApplication") continue;
      await applyAction(action, gen);
    }
    markStep("fill", "done");

    // Finish the step's automatic work and rescan before presenting questions.
    return "done";
  }

  /* ---------------- validation ---------------- */

  function validate() {
    const open = S.fields.filter((f) => f.required && !(f.value || "").trim());
    const sensitiveOpen = open.filter((f) => f.sensitive);
    const badUrl = S.fields.filter(
      (f) => f.type === "url" && f.value && !/^https?:\/\/\S+\.\S{2,}/i.test(f.value),
    );
    const badEmail = S.fields.filter(
      (f) => f.type === "email" && f.value && !/^\S+@\S+\.\S{2,}$/.test(f.value),
    );
    const unverified = S.changes.filter((c) => !c.verified);
    const invalid = S.fields.filter(f => f.el?.isConnected &&
      (f.el.getAttribute("aria-invalid") === "true" ||
       (f.el.willValidate && f.el.validity && !f.el.validity.valid)));
    const blockers = new Map(open.map(f => [f.id, { fieldId: f.id, message: `${f.label} is required.` }]));
    for (const f of [...badUrl, ...badEmail, ...invalid]) {
      if (!blockers.has(f.id)) blockers.set(f.id, { fieldId: f.id, message: `${f.label}: ${f.el?.validationMessage || "the site needs a valid answer."}` });
    }
    for (const c of unverified) {
      if (!blockers.has(c.fieldId)) blockers.set(c.fieldId, { fieldId: c.fieldId, message: `${c.label} has not been verified. Check it on the page.` });
    }

    return {
      checks: [
        {
          id: "required",
          label: "Required fields complete",
          ok: open.length === 0,
          detail: open.length ? `${open.length} still empty on this step` : undefined,
        },
        { id: "urls", label: "URLs valid", ok: badUrl.length === 0 },
        { id: "email", label: "Email format valid", ok: badEmail.length === 0 },
        {
          id: "sensitive",
          label: "No unresolved sensitive questions",
          ok: sensitiveOpen.length === 0,
          detail: sensitiveOpen.length
            ? `${sensitiveOpen.length} awaiting you`
            : undefined,
        },
        {
          id: "verified",
          label: "All writes verified against the page",
          ok: unverified.length === 0,
          detail: unverified.length ? `${unverified.length} unconfirmed` : undefined,
        },
      ],
      blockers: [...blockers.values()],
    };
  }

  function recordPage() {
    const c = counts();
    const onThisStep = S.changes.filter((x) => x.step === S.step);
    S.pages = S.pages.filter((p) => p.step !== S.step);
    S.pages.push({
      step: S.step,
      label: S.context.stepLabel || `Step ${S.step}`,
      filled: onThisStep.length,
      total: c.total,
    });
    S.stats.pagesCompleted = S.pages.length;
  }

  const isOpen = (f) => !(f.value || "").trim();

  /** An open question the agent writes prose for: the only kind research serves. */
  const hasOpenNarrative = () =>
    S.fields.some((f) => f.type === "textarea" && !f.sensitive && isOpen(f));

  /** Required, non-sensitive, still empty, and not yet acted on this step. */
  const untouchedOpen = () =>
    S.fields.filter((f) => f.required && !f.sensitive && isOpen(f) && !S.addressed.has(f.id));

  /**
   * A step with nothing the agent may fill: every open field is a decision of
   * yours. The model could only hand them back, so do that directly.
   */
  async function handBackOpen() {
    S.passes += 1;
    const yours = S.fields.filter(
      (f) => isOpen(f) && f.sensitive && window.__screenmatePrefs.shouldAsk(f, S.prefs),
    );
    log(
      "think",
      "Decision",
      yours.length
        ? "Nothing here for the agent to fill; the rest of this step is yours to answer."
        : "Nothing left to fill on this step.",
    );
    for (const f of yours) {
      // queueApproval notes files once and never asks the same question twice.
      const already = S.resolvedSensitive.has(f.id);
      await queueApproval(f, f.sensitiveReason);
      if (!already) {
        log("lock", `${f.label} requires user input`, f.sensitiveReason);
        markStep("approval", "active");
      }
    }
    return "done";
  }

  /**
   * The plan for a step with no open free-text question. Research cannot be
   * needed there, and a model's plan could only restate what the page already
   * shows — so the step goes straight to work instead of waiting on it.
   */
  function localPlan() {
    const open = S.fields.filter(isOpen);
    const yours = open.filter((f) => f.sensitive && f.type !== "file").length;
    const steps = [
      { kind: "observe", label: "Read the live form" },
      { kind: "fill", label: "Fill known profile fields" },
    ];
    if (yours) steps.push({ kind: "approval", label: "Apply your answers, ask the rest" });
    steps.push({ kind: "validate", label: "Validate this step" });
    const role = [S.context.jobTitle, S.context.company].filter(Boolean).join(" at ");
    return {
      goal: `Complete the ${role || "application"} application from your profile, leaving your decisions to you.`.slice(0, 150),
      observation: `${open.length} of ${S.fields.length} fields are open${
        yours ? `, ${yours} of them yours to decide` : ""
      }.`,
      steps,
      researchNeeded: false,
      researchRationale: "No open question depends on company context, so research is skipped.",
    };
  }

  /* ---------------- the page loop ---------------- */

  /**
   * Walks the wizard. Re-entrant: when a sensitive question pauses the run, the
   * user's answer calls back in here and the loop picks up where it stopped.
   */
  async function pageLoop(gen) {
    for (let guard = 0; guard < MAX_STEPS * 3; guard++) {
      if (stale(gen)) return "stale";

      const sig = window.__screenmateScan.pageSignature();
      if (sig !== S.observedSig) {
        setStatus("observing");
        if (!(await observe())) return "error";
        S.observedSig = window.__screenmateScan.pageSignature();
        S.addressed = new Set();
        S.passes = 0;        if (stale(gen)) return "stale";

        // Plan per step: each page of a wizard asks for different things. The
        // model's plan is worth its round-trip only when research might be
        // needed, which takes an open free-text question.
        setStatus("planning");
        let plan;
        let early = null;
        if (hasOpenNarrative()) {
          // Research is only ever wanted for an open free-text question, and
          // this step has one, so it starts now, alongside the plan: the two
          // waits overlap instead of adding up. The plan still decides whether
          // the result is used.
          if (!S.research) early = researchRequest();
          const res = await api("agent", payload("plan"));
          if (stale(gen)) return "stale";
          if (res.ok) {
            plan = res.data;
          } else if (res.status === 401 || res.status === 0 || res.error === ORPHANED.error) {
            // Unreachable or refused: nothing further would work either.
            failAgent(res);
            return "error";
          } else {
            // The plan is a summary and a research call. A model that fumbled
            // it is no reason to stop: plan locally, and look the company up,
            // since an open question here asks about it.
            log("warn", "Planner stumbled, continuing with a simple plan", res.reason || res.error, true);
            plan = {
              ...localPlan(),
              researchNeeded: true,
              researchRationale: "An open question asks about this company, so SCREENMATE looks it up.",
            };
          }
        } else {
          plan = localPlan();
        }

        if (!S.goal) S.goal = plan.goal;
        S.steps = plan.steps.map((s) => ({ ...s, status: "pending" }));
        log("observe", "Observation", plan.observation);
        markStep("observe", "done");

        if (plan.researchNeeded) {
          log("research", "Research required", plan.researchRationale);
          await runResearch(early);
        } else {
          log("think", "Context check", plan.researchRationale);
          markStep("research", "skipped");
        }      }

      // Ask for unknown required facts and unresolved decisions before writing.
      if (await collectPreflightQuestions()) return "waiting";
      if (stale(gen)) return "stale";

      // Your resume goes in first: a site that reads it may fill fields from it.
      await attachSavedResume(gen);
      if (stale(gen)) return "stale";

      const fromPrefs = await applyPreferences(gen);
      if (fromPrefs) {
        log(
          "success",
          `${fromPrefs} question${fromPrefs === 1 ? "" : "s"} answered from your saved answers`,
          "Saved answers matched these questions.",
        );
      }
      if (stale(gen)) return "stale";

      // These are exact profile transcriptions, so there is no model round-trip.
      for (const field of S.fields) {
        if (!isOpen(field)) continue;
        const value = window.__screenmateAct.directProfileValue(field, S.profile);
        if (!value) continue;
        await applyAction({ tool: field.type === "select" ? "selectOption" : "fillField",
          args: { fieldId: field.id, value }, confidence: "high" }, gen);
        if (stale(gen)) return "stale";
      }

      // Back here after your answer, the agent has already had its turn at
      // everything else on this step; another call could only repeat itself.
      // And a step where every open field is yours needs no model at all.
      let outcome;
      if (S.passes > 0 && !untouchedOpen().length) outcome = "done";
      else if (!S.fields.some((f) => isOpen(f) && !f.sensitive)) outcome = await handBackOpen();
      else outcome = await runPass(gen);
      let extra = 0;
      while (outcome === "done" && extra < 1) {
        extra += 1;
        // A second pass only for required fields the first one never touched.
        if (!untouchedOpen().length) break;
        outcome = await runPass(gen);
      }
      if (outcome !== "done") return outcome;

      // Answers often reveal dependent questions without a page navigation.
      // Reach a stable form before interrupting the applicant.
      const fresh = window.__screenmateScan.scanFields();
      const liveIds = new Set(fresh.map(f => f.id));
      S.approvalQueue = S.approvalQueue.filter(q =>
        fresh.some(f => f.id === q.fieldId && f.label === q.label));
      const previousIds = new Set(S.fields.map(f => f.id));
      const metadataChanged = fresh.some(f => {
        const previous = S.fields.find(p => p.id === f.id);
        return previous && (previous.label !== f.label || previous.type !== f.type || previous.required !== f.required);
      });
      if (fresh.some(f => !previousIds.has(f.id)) ||
          S.fields.some(f => !liveIds.has(f.id)) || metadataChanged) {
        S.observedSig = null;
        continue;
      }
      for (const field of S.fields) {
        const current = fresh.find(f => f.id === field.id);
        if (current) field.value = current.value;
      }
      S.approvalQueue = S.approvalQueue.filter(q => S.fields.some(f => f.id === q.fieldId && isOpen(f)));

      // Nothing required leaves this step unasked: what the agent could not
      // fill, you are asked for, and your answer goes into the form.
      if (await askForMissing()) return "waiting";

      markStep("fill", "done");
      markStep("approval", "done");
      recordPage();
      S.report = validate();
      markStep("validate", "done");
      if (S.report.blockers.length) {
        S.submitHandoff = window.__screenmateNav.findSubmitControl({ fields: S.fields });
        log("warn", "Required answers are still missing", "Answer the remaining questions before moving to the next step.");
        break;
      }

      /* --- advance, or stop --- */
      const next = window.__screenmateNav.findAdvanceControl({ fields: S.fields });
      if (!next) {
        S.submitHandoff = window.__screenmateNav.findSubmitControl({ fields: S.fields });
        break;
      }
      if (S.step >= MAX_STEPS) {
        log("warn", "Step limit reached", `Stopped after ${MAX_STEPS} steps.`);
        break;
      }

      setStatus("advancing");
      log("nav", `Advancing to step ${S.step + 1}`, `Clicking "${next.text}"`);
      // Some sites load a whole new page for the next step, which ends this
      // script mid-click. Leave a note first, so the next page carries on.
      await saveRun({ resume: true, step: S.step + 1 });
      const moved = await window.__screenmateNav.advance(next);
      if (!moved.ok) {
        clearRun();
        log("warn", "Could not advance", moved.reason);
        break;
      }
      // Still the same page: the note is not needed.
      clearRun();
      S.step += 1;
      // Wizard steps can reuse IDs; only stored answers carry across steps.
      S.resolvedSensitive.clear();
      S.failedWrites.clear();
      S.noted.clear();
      S.flagReasons.clear();
      S.siteFilled.clear();
      S.observedSig = null;    }

    await finish(gen);
    return "done";
  }

  async function finish(gen) {
    if (stale(gen)) return;
    S.report = validate();
    const blockers = S.report.blockers.length;
    log(
      blockers === 0 ? "success" : "warn",
      "Application check complete",
      `${S.stats.pagesCompleted} step${S.stats.pagesCompleted === 1 ? "" : "s"} · ${blockers} blocker${blockers === 1 ? "" : "s"}`,
    );

    if (S.submitHandoff && !blockers) {
      log(
        "lock",
        "Ready to submit when you are",
        S.submitHandoff.disabled
          ? `"${S.submitHandoff.text}" is disabled on the page: the site is still waiting on something.`
          : `SCREENMATE never presses "${S.submitHandoff.text}" on its own. Confirm in the panel and it will.`,
      );
    }

    if (S.changes.length) {
      markStep("review", "active");
      setStatus("reviewing");
      return;
    }
    setStatus("complete");
  }

  /* ---------------- run ---------------- */

  async function setPref(topic, value) {
    S.prefs = { ...S.prefs, [topic]: value };
    paint();
    try {
      await window.__screenmatePrefs.setOne(topic, value);
    } catch (err) {
      S.banner = err?.message || "Could not save that answer. Try again.";
      paint();
    }
  }

  /**
   * Start with the profile and answers already available. Preferences can be
   * edited any time; an unrelated setup questionnaire never blocks a run.
   */
  async function startRun({ anyway = false } = {}) {
    if (S.running || S.starting) return;
    S.starting = true;
    try {
      // Read fresh: you may have edited your profile in settings since the
      // panel opened.
      const info = await message({ type: "screenmate:getProfile" });
      S.profile = info?.profile || S.profile || {};
      S.needsProfile = false;
      if (!anyway && !String(S.profile.name || "").trim() && !String(S.profile.email || "").trim()) {
        S.needsProfile = true;
        paint();
        return;
      }
      S.prefs = await window.__screenmatePrefs.load();
      S.needsPrefs = false;
      void run();
    } catch (err) {
      S.banner = err?.message || "Could not load your settings. Try again.";
      setStatus("error");
    } finally {
      S.starting = false;
    }
  }

  async function run() {
    if (S.running) return;
    S.running = true;
    const gen = S.gen;
    S.banner = null;
    S.observedSig = null;

    try {
      await pageLoop(gen);
    } catch (err) {
      if (!stale(gen)) {
        S.banner = err?.message || "The page changed while SCREENMATE was working. Try again.";
        setStatus("error");
      }
    } finally {
      if (!stale(gen)) S.running = false;
    }
  }

  /* ---------------- user actions ---------------- */

  /** Lists your answer with the agent's changes, so it can be edited or reverted like them. */
  function recordUserAnswer(field, after) {
    const entry = {
      after,
      verified: true,
      byUser: true,
      regenerable: false,
      options: field.type === "select" && !field.multiple ? field.options : undefined,
    };
    const earlier = S.changes.find((c) => c.fieldId === field.id && c.step === S.step);
    if (earlier) Object.assign(earlier, entry);
    else {
      S.changes.push({
        fieldId: field.id,
        label: field.label,
        before: "",
        level: field.level,
        step: S.step,
        ...entry,
      });
    }
  }

  /** Marks the question at the head of the queue settled, and moves on. */
  async function settleQuestion(req, shownValue, { remember = false, value = shownValue } = {}) {
    const gen = S.gen;
    S.stats.userDecisions += 1;
    S.resolvedSensitive.add(req.fieldId);
    const queuedAt = S.approvalQueue.findIndex((item) => item.fieldId === req.fieldId);
    if (queuedAt >= 0) S.approvalQueue.splice(queuedAt, 1);
    const shown = shownValue.length > 80 ? `${shownValue.slice(0, 79)}…` : shownValue;
    log(
      "success",
      `${req.label} answered by you`,
      req.kind === "missing" || req.kind === "flagged"
        ? `"${shown}" — your answer, written into the form.`
        : `"${shown}" — your decision, not the agent's.`,
    );

    // Remembered only once it has really landed, so a failed answer is never
    // replayed on the next application.
    if (req.topic && remember) {
      try {
        S.prefs = await window.__screenmatePrefs.setOne(req.topic, value);
        log("prefs", "Saved as a standing answer", "Applied automatically from now on.");
      } catch {
        log("warn", "Answer filled, but not remembered", "Your answer is on the page. SCREENMATE will ask again next time.");
      }
    }
    // A second copy of this question may already be queued on the same step.
    // Apply the newly remembered answer before showing the next card.
    if (stale(gen)) return;
    await applyPreferences(gen);
    if (stale(gen)) return;
    if (S.approvalQueue.length) {
      paint();
      return;
    }
    resumeAfterApproval();
  }

  async function answer(fieldId, raw, remember = true) {
    const req = S.approvalQueue.find((item) => item.fieldId === fieldId);
    if (!req || S.answering) return;
    const value = Array.isArray(raw)
      ? raw.join(window.__screenmateScan.MULTI_SEPARATOR)
      : String(raw ?? "").trim();
    const field = S.fields.find((f) => f.id === req.fieldId);
    if (!field) {
      await settleQuestion(req, value);
      return;
    }

    // Writing a dropdown answer takes a few seconds on a slow site. Until it
    // lands the card shows it is busy, and a second click does nothing.
    S.answering = true;
    const gen = S.gen;
    req.busy = true;
    req.error = null;
    paint();
    let check = null;
    let res = null;
    try {
      res = await window.__screenmateAct.applyWrite(field, value);
      check = res.ok ? await window.__screenmateAct.verifySettled(field, res.chosen || value) : null;
    } catch (err) {
      res = { ok: false, reason: err?.message || "The page could not accept this answer" };
    } finally {
      S.answering = false;
      req.busy = false;
    }
    if (stale(gen) || !S.approvalQueue.some((item) => item.fieldId === req.fieldId)) return;

    if (!check?.ok) {
      // The question stays open: nothing is marked answered or remembered
      // when the page does not hold the answer.
      const reason = res?.ok ? check?.summary || "The value could not be verified" : res?.reason || "The page did not accept the value";
      req.error = `That did not stick on the page (${reason}). Try another answer, or set it on the page yourself and press "I set it on the page".`;
      log("warn", `Could not set your answer on ${field.label}`, reason);
      return paint();
    }

    window.__screenmateAct.highlight(field.el);
    field.value = check.actual;
    recordUserAnswer(field, check.actual || value);
    await settleQuestion(req, check.actual || value, {
      remember,
      value: res.chosen || value,
    });
  }

  /**
   * For a widget SCREENMATE cannot operate: you answered on the page itself.
   * Accepted only once the page actually shows an answer.
   */
  async function confirmManual(fieldId) {
    const req = S.approvalQueue.find((item) => item.fieldId === fieldId);
    const field = req && S.fields.find((f) => f.id === req.fieldId);
    if (!req || !field || S.answering) return;
    const actual = field.el?.isConnected ? window.__screenmateScan.currentValue(field.el) : "";
    if (!actual.trim()) {
      req.error = "The page still shows this as empty. Answer it on the page first, then press this again.";
      return paint();
    }
    if (field.type === "file") {
      fileAttached(req, field, field.el.files?.[0]?.name || "your file", "attached by you on the page");
      return;
    }
    field.value = actual;
    recordUserAnswer(field, actual);
    await settleQuestion(req, actual);
  }

  /** Picks the run back up once the last pending question is settled. */
  function resumeAfterApproval() {
    if (S.approvalQueue.length) return paint();
    S.preflightReview = false;
    markStep("approval", "done");
    if (S.running) return;
    S.running = true;
    const gen = S.gen;
    setStatus("acting");
    void (async () => {
      try {        if (!stale(gen)) await pageLoop(gen);
      } catch (err) {
        if (!stale(gen)) {
          S.banner = err?.message || "Could not continue. Try again.";
          setStatus("error");
        }
      } finally {
        if (!stale(gen)) S.running = false;
      }
    })();
  }

  /** Settles an upload question once the page holds the file. */
  function fileAttached(req, field, name, how) {
    if (!S.approvalQueue.some((item) => item.fieldId === req.fieldId)) return;
    field.value = window.__screenmateScan.currentValue(field.el) || "1 file selected";
    S.changes.push({
      fieldId: field.id,
      label: field.label,
      before: "",
      after: name,
      verified: true,
      level: field.level,
      step: S.step,
      byUser: true,
      regenerable: false,
      file: true,
    });
    const queuedAt = S.approvalQueue.findIndex((item) => item.fieldId === req.fieldId);
    if (queuedAt >= 0) S.approvalQueue.splice(queuedAt, 1);
    S.resolvedSensitive.add(req.fieldId);
    S.stats.userDecisions += 1;
    window.__screenmateAct.highlight(
      field.el.closest("li, [class*=question], [class*=field], [class*=upload]") || field.el,
    );
    log("success", `${req.label} attached`, `"${name}", ${how}.`);
    resumeAfterApproval();
  }

  /**
   * Puts a file into the upload the current question is about: the one you
   * chose in the panel, or your saved resume. It reaches the site exactly as
   * if you had used the site's own button.
   */
  async function attachToQuestion(file, how, fieldId) {
    const req = S.approvalQueue.find((item) => item.fieldId === fieldId);
    const field = req && S.fields.find((f) => f.id === req.fieldId);
    if (!req || !field || !file || S.answering) return;
    S.answering = true;
    req.busy = true;
    req.error = null;
    paint();
    let res;
    try {
      res = await window.__screenmateAct.attachFile(field, file);
    } catch (err) {
      res = { ok: false, reason: err?.message || "The upload failed" };
    } finally {
      S.answering = false;
      req.busy = false;
    }
    if (!res.ok) {
      req.error = `This site did not take the file (${res.reason}). Attach it on the page yourself, then press "I attached it on the page".`;
      req.sitePicker = true;
      log("warn", `Could not attach ${file.name}`, res.reason);
      return paint();
    }
    fileAttached(req, field, file.name, how);
  }

  const attachChosen = (file, fieldId) => void attachToQuestion(file, "chosen by you", fieldId);
  const attachSaved = async (fieldId) =>
    attachToQuestion(await savedResume(), "your saved resume", fieldId);

  /**
   * The site's own file picker, for an upload that would not take a file
   * handed to it. Must stay synchronous: the picker only opens inside the
   * click that asked for it.
   */
  function pickFile(fieldId) {
    const req = S.approvalQueue.find((item) => item.fieldId === fieldId);
    const field = req && S.fields.find((f) => f.id === req.fieldId);
    const input = field?.el;
    if (!input?.isConnected) return;
    if (S.filePick) input.removeEventListener("change", S.filePick);
    S.filePick = () => {
      const file = input.files?.[0];
      if (!file) return; // picker cancelled: the question stays open
      input.removeEventListener("change", S.filePick);
      S.filePick = null;
      fileAttached(req, field, file.name, "chosen by you");
    };
    input.addEventListener("change", S.filePick);
    input.click();
  }

  /** Leaves an optional sensitive question blank and moves on. */
  function skipApproval(fieldId) {
    // Mid-write, the question at the head is still being answered.
    if (S.answering) return;
    const at = S.approvalQueue.findIndex((item) => item.fieldId === fieldId);
    const req = at >= 0 ? S.approvalQueue.splice(at, 1)[0] : null;
    if (!req) return;
    S.resolvedSensitive.add(req.fieldId);
    log(
      "lock",
      `${req.label} left blank`,
      req.kind === "file" ? "You chose not to attach a file." : "You chose not to answer it.",
    );
    resumeAfterApproval();
  }

  /** Writes a user-corrected value straight to the page. */
  async function editChange(fieldId, value) {
    const field = S.fields.find((f) => f.id === fieldId);
    const change = S.changes.find((c) => c.fieldId === fieldId && c.step === S.step);
    if (!field) return;

    const text = (value || "").trim();
    if (!text) {
      log("warn", `${field.label} left unchanged`, "An empty edit was ignored.");
      return;
    }

    const res = await window.__screenmateAct.applyWrite(field, text);
    if (!res.ok) {
      log("warn", `Could not write your edit to ${field.label}`, res.reason);
      return;
    }
    window.__screenmateAct.highlight(field.el);
    const landed = res.chosen || text;
    const check = await window.__screenmateAct.verifySettled(field, landed);
    field.value = check.actual;

    if (change) {
      change.after = landed;
      change.verified = check.ok;
      // Once you have edited it, it is your value, not a suggestion.
      change.fromPreference = false;
      change.edited = true;
    }
    log("write", `${field.label} edited by you`, text.slice(0, 90));
    paint();
  }

  /** Asks for a different take on one generated answer. */
  async function regenerateField(fieldId) {
    if (S.running) return;
    const field = S.fields.find((f) => f.id === fieldId);
    if (!field) return;

    S.running = true;
    const gen = S.gen;
    const previous = S.status;
    setStatus("acting");
    try {
      log("think", `Rewriting ${field.label}`, "Producing a different angle.");
      const res = await api("agent", payload("regenerate", { targetFieldId: fieldId }));
      if (!res.ok) {
        log("warn", "Regeneration unavailable", res.reason || res.error);
        return;
      }
      const value = res.data?.value;
      if (!value) return;

      const w = await window.__screenmateAct.applyWrite(field, value);
      if (!w.ok) {
        log("warn", `Could not write the new answer to ${field.label}`, w.reason);
        return;
      }
      window.__screenmateAct.highlight(field.el);
      const check = await window.__screenmateAct.verifySettled(field, value);
      field.value = check.actual;

      const change = S.changes.find((c) => c.fieldId === fieldId && c.step === S.step);
      if (change) {
        change.after = value;
        change.verified = check.ok;
      }
      log("write", `${field.label} rewritten`, value.slice(0, 90));
      if (res.data.note) log("think", "What changed", res.data.note, true);
    } finally {
      if (!stale(gen)) {
        S.running = false;
        setStatus(previous === "idle" ? "reviewing" : previous);
      }
    }
  }

  /**
   * Takes a file back out of an upload field. A site that already took the
   * file into its own list keeps showing it, so that is reported, not hidden.
   */
  function clearUpload(field, name) {
    const el = field.el;
    if (!el?.isConnected) return { ok: false, reason: "The upload field left the page" };
    try {
      el.value = "";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } catch {
      /* a read-only file list: the page check below decides */
    }
    const around = el.closest("form, [class*=field], [class*=upload], [class*=Upload]");
    return around?.textContent.includes(name)
      ? { ok: false, reason: `The site still lists ${name}. Use its own Remove button.` }
      : { ok: true };
  }

  /** Puts one field back to whatever it held before the agent touched it. */
  async function revertOne(fieldId) {
    const change = S.changes.find((c) => c.fieldId === fieldId && c.step === S.step);
    const field = S.fields.find((f) => f.id === fieldId);
    if (!change || !field) return;

    const res = change.file
      ? clearUpload(field, change.after)
      : await window.__screenmateAct.applyWrite(field, change.before || "");
    if (!res.ok) {
      // Keep it listed: it is still on the page.
      log("warn", `Could not revert ${change.label}`, res.reason || "Change it back on the page.");
      return;
    }
    field.value = change.before || "";
    S.changes = S.changes.filter((c) => c.fieldId !== fieldId || c.step !== S.step);
    S.resolvedSensitive.add(fieldId);
    log("warn", `${change.label} reverted`, "Put back to what it was.");
    S.report = validate();
    paint();
  }

  async function revertAll() {
    const stuck = [];
    for (const c of S.changes.filter(c => c.step === S.step)) {
      const field = S.fields.find((f) => f.id === c.fieldId);
      if (field) {
        const res = c.file
          ? clearUpload(field, c.after)
          : await window.__screenmateAct.applyWrite(field, c.before || "");
        if (res.ok) field.value = c.before || "";
        else stuck.push(c);
      }
    }
    log(
      "warn",
      "Agent changes reverted on this step",
      "Earlier steps are left as they are — navigate back to change those.",
    );
    if (stuck.length) {
      log(
        "warn",
        `${stuck.length} could not be reverted automatically`,
        `${stuck.map((c) => c.label).join(", ")} — change these back on the page.`,
      );
    }
    // Anything that could not be put back is still on the page, so it stays listed.
    S.changes = S.changes.filter((c) => c.step !== S.step || stuck.includes(c));
    S.report = validate();
    setStatus("complete");
  }

  /**
   * Submits the application. Reached only through your explicit two-step
   * confirmation in the panel; nothing in the run calls it.
   */
  async function submitNow() {
    if (S.running || S.status === "submitting" || S.status === "submitted") return;
    const existing = new Map(S.fields.map(f => [f.id, f]));
    S.fields = window.__screenmateScan.scanFields().map(f => ({ ...existing.get(f.id), ...f }));
    // You may have typed into the page yourself since the run: read it fresh.
    for (const f of S.fields) {
      if (f.el?.isConnected) f.value = window.__screenmateScan.currentValue(f.el);
    }
    S.report = validate();
    const empty = S.report.blockers;
    if (empty.length) {
      log(
        "warn",
        "Not submitted: required fields are still empty",
        empty.map((b) => b.message.replace(/ is required\.$/, "")).join(" · "),
      );
      return paint();
    }
    setStatus("submitting");
    log(
      "nav",
      "Submitting, because you confirmed",
      `Pressing "${S.submitHandoff?.text || "Submit"}" on the page.`,
    );
    // A site may answer with a whole new page; the note lets that page
    // report the outcome instead of it vanishing with this script.
    await saveRun({ submitPending: true });
    const res = await window.__screenmateNav.submitApplication({ fields: S.fields });
    if (res.ok) {
      clearRun();
      S.submitted = res.detail;
      log("success", "Application submitted", res.detail);
      setStatus("submitted");
      return;
    }
    clearRun();
    S.submitHandoff = window.__screenmateNav.findSubmitControl({ fields: S.fields }) || S.submitHandoff;
    log("warn", res.unknown ? "Submit pressed, not confirmed yet" : "Not submitted", res.reason);
    setStatus("complete");
  }

  function acceptAll() {
    log("success", "All changes accepted", `${S.changes.length} fields confirmed.`);
    S.report = validate();
    markStep("review", "done");
    setStatus("complete");
  }

  async function answerMissing() {
    if (S.running || S.answering) return;
    for (const f of S.fields) {
      if (f.el?.isConnected) f.value = window.__screenmateScan.currentValue(f.el);
      const invalid = f.el?.getAttribute("aria-invalid") === "true" ||
        (f.el?.willValidate && !f.el.validity.valid);
      if (f.required && (isOpen(f) || invalid)) {
        S.resolvedSensitive.delete(f.id);
        if (invalid && !isOpen(f)) await queueApproval(f, "The site needs a valid answer. Correct it here.", "missing");
      }
    }
    await askForMissing();
    S.report = validate();
    paint();
  }

  function reset() {
    S.gen += 1;
    S.running = false;
    clearRun();
    Object.assign(S, {
      status: "idle",
      context: {},
      goal: null,
      steps: [],
      activity: [],
      research: null,
      approvalQueue: [],
      preflightReview: false,
      changes: [],
      report: null,
      banner: null,
      step: 1,
      pages: [],
      observedSig: null,
      lastObservationLog: null,
      submitHandoff: null,
      needsPrefs: false,
      needsProfile: false,
      resolvedSensitive: new Set(),
      failedWrites: new Set(),
      noted: new Set(),
      addressed: new Set(),
      passes: 0,
      submitted: null,
      answering: false,
      siteFilled: new Set(),
      flagReasons: new Map(),
      stats: EMPTY_STATS(),
    });
    resumeCache = undefined;
    void observe().then(() => {
      S.observedSig = window.__screenmateScan.pageSignature();
      paint();
    });
  }

  /* ---------------- surviving a page load ---------------- */

  /**
   * What a run needs to carry on when the site loads a whole new page for its
   * next step (iCIMS, Taleo and older portals do). Plain data only: element
   * handles die with the page.
   */
  function snapshot(extra = {}) {
    return {
      host: location.host,
      at: Date.now(),
      context: S.context,
      goal: S.goal,
      activity: S.activity.slice(-40),
      research: S.research,
      changes: S.changes.map((c) => ({ ...c })),
      stats: S.stats,
      step: S.step,
      pages: S.pages,
      ...extra,
    };
  }

  const message = (msg) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          void chrome.runtime.lastError;
          resolve(res ?? null);
        });
      } catch {
        // The extension was reloaded under this page.
        resolve(null);
      }
    });

  const saveRun = (extra) => message({ type: "screenmate:saveRun", run: snapshot(extra) });
  const clearRun = () => void message({ type: "screenmate:clearRun" });

  /**
   * Picks a run back up on the page the site loaded for its next step, or
   * reports what the site said after a submit that loaded a new page.
   */
  async function resumeRun(saved) {
    // The next step's form may render a moment after load.
    for (let i = 0; i < 40 && !window.__screenmateScan.quickCount() && !saved.submitPending; i++) {
      await sleep(200);
    }
    await mount({ collapsed: false, restoring: true });
    Object.assign(S, {
      context: saved.context || {},
      goal: saved.goal || null,
      activity: saved.activity || [],
      research: saved.research || null,
      changes: saved.changes || [],
      stats: saved.stats || EMPTY_STATS(),
      step: saved.step || 1,
      pages: saved.pages || [],
    });

    if (saved.submitPending) {
      const said = document.body?.innerText.match(window.__screenmateNav.SUBMITTED)?.[0];
      if (said) {
        S.submitted = `The site says: "${window.__screenmateScan.cleanText(said)}".`;
        log("success", "Application submitted", S.submitted);
        setStatus("submitted");
      } else {
        log(
          "warn",
          "Submit pressed; this page does not confirm it",
          "Check the page (or your email) before trying again.",
        );
        setStatus("complete");
      }
      return;
    }

    log(
      "nav",
      `Continuing on step ${S.step}`,
      "The site loaded a new page for this step. SCREENMATE picked up where it left off.",
    );
    S.prefs = await window.__screenmatePrefs.load();
    void run();
  }

  /* ---------------- boot ---------------- */

  async function mount({ collapsed = false, restoring = false } = {}) {
    if (S.panel) {
      S.panel.toggle(false);
      return;
    }
    // This page is an application: wake the backend now, while the person is
    // still reading, so the first Run does not wait on a cold start.
    void message({ type: "screenmate:warm" });
    const info = await message({ type: "screenmate:getProfile" });
    S.profile = info?.profile || {};
    S.prefs = await window.__screenmatePrefs.load();
    // A form inside an iframe shows its panel in the top page, when the top
    // page has SCREENMATE running to host it.
    const remote = await window.__screenmateFrames.topCanHost();
    if (S.panel) return; // mounted by another caller while we waited

    const Panel = remote ? window.__screenmateFrames.RemotePanel : window.__screenmatePanel;
    S.panel = new Panel(
      {
        onRun: () => void startRun(),
        onRunAnyway: () => void startRun({ anyway: true }),
        onRescan: () => reset(),
        onAnswer: (fieldId, v, remember) => void answer(fieldId, v, remember),
        onSkip: (fieldId) => skipApproval(fieldId),
        onPickFile: (fieldId) => pickFile(fieldId),
        onAttachFile: (file, fieldId) => attachChosen(file, fieldId),
        onAttachSaved: (fieldId) => void attachSaved(fieldId),
        onConfirmManual: (fieldId) => void confirmManual(fieldId),
        onSubmit: () => void submitNow(),
        onSetPref: (topic, value) => void setPref(topic, value),
        onPrefsDone: async (freeValues = {}) => {
          if (S.savingPrefs || S.running) return;
          S.savingPrefs = true;
          try {
            S.prefs = await window.__screenmatePrefs.setMany(freeValues);
            S.needsPrefs = false;
            // Edited after a run: save them, do not start the agent over.
            if (S.status === "idle" || S.status === "error") return void run();
            log("prefs", "Standing answers updated", "They apply from the next run on.");
          } catch (err) {
            S.banner = err?.message || "Your answers could not be saved. Try again.";
            paint();
          } finally {
            S.savingPrefs = false;
          }
        },
        onEditPrefs: () => {
          S.needsPrefs = true;
          paint();
        },
        onOpenSettings: () => void message({ type: "screenmate:openSettings" }),
        onAcceptAll: () => acceptAll(),
        onAnswerMissing: () => void answerMissing(),
        onRevertAll: () => void revertAll(),
        onEditChange: (id, v) => void editChange(id, v),
        onRegenerate: (id) => void regenerateField(id),
        onRevertOne: (id) => void revertOne(id),
        onExpand: () => {
          // Classification costs a backend call, so defer it until the panel is
          // actually opened rather than firing on every page load.
          if (!S.fields.length || S.fields.__unclassified) {
            void observe().then(() => paint());
          }
        },
        onClose: () => {
          // Closed on purpose: it stays closed on this page until you open it.
          S.dismissedAt = location.href;
          S.gen += 1;
          S.running = false;
          clearRun();
          S.panel.remove();
          S.panel = null;
        },
      },
      { collapsed },
    );

    if (restoring) {
      paint();
      return;
    }

    if (collapsed) {
      // Enough for the pill's badge without touching the network.
      const local = window.__screenmateScan.scanFields();
      S.context = window.__screenmateScan.pageContext();
      S.fields = local.map((f) => ({ ...f, level: "safe", sensitive: false }));
      S.fields.__unclassified = true;
      paint();
      return;
    }

    await observe();
    paint();
  }

  /**
   * Auto-mounts a collapsed pill when the page looks like an application form.
   * Deliberately conservative: a login box or a search field must not summon an
   * agent panel.
   */
  function looksLikeApplication() {
    // Most pages have no form at all: count controls before reading any.
    if (window.__screenmateScan.quickCount() < 4) return false;
    const fields = window.__screenmateScan.scanFields();
    if (fields.length < 4) return false;
    const text = fields.map((f) => f.label.toLowerCase()).join(" ");
    const hasIdentity = /name|email/.test(text);
    if (!hasIdentity) return false;

    // A wizard's first step is often short, so an advance control counts as
    // evidence of depth alongside the usual application vocabulary.
    const jobWords =
      /resume|cover|why|experience|portfolio|linkedin|degree|school|salary|sponsor|employer|position/;
    const hasAdvance = Boolean(window.__screenmateNav?.findAdvanceControl());
    return fields.length >= 6 || jobWords.test(text) || hasAdvance;
  }

  /* ---------------- frame election ---------------- */

  /**
   * The content script runs in every frame, because embedded ATS forms (Taleo,
   * iCIMS, embedded Greenhouse) live in an iframe while the job posting sits in
   * the parent. Exactly one frame should own the panel, so candidates announce
   * their field count and the richest form wins.
   */
  const ELECTION = "screenmate:claim";
  const isTop = window === window.top;
  let electionTimer = null;
  const claims = [];
  /** Top frame only: an embedded form won the election and owns the panel. */
  let childOwnsPanel = false;

  function claimFrame(count) {
    const msg = { __screenmate: ELECTION, count, href: location.href };
    try {
      window.top.postMessage(msg, "*");
    } catch {
      /* cross-origin top: fall back to owning our own frame */
      void mount({ collapsed: true });
    }
  }

  if (isTop) {
    window.addEventListener("message", (ev) => {
      const d = ev.data;
      if (!d || d.__screenmate !== ELECTION) return;
      claims.push({ count: d.count, source: ev.source });
      clearTimeout(electionTimer);
      // Wait a beat for slower frames before deciding.
      electionTimer = setTimeout(() => {
        const winner = claims.reduce((a, b) => (b.count > a.count ? b : a));
        if (winner.source === window) {
          if (!S.panel && S.dismissedAt !== location.href) void mount({ collapsed: true });
        } else {
          childOwnsPanel = true;
          try {
            winner.source.postMessage(
              { __screenmate: "screenmate:youWon" },
              "*",
            );
          } catch {
            /* ignore */
          }
        }
      }, 600);
    });
  }

  window.addEventListener("message", (ev) => {
    if (ev.data?.__screenmate === "screenmate:youWon" && !S.panel) {
      void mount({ collapsed: true });
    }
  });

  /** True while a run carried over from the previous page is being restored. */
  let resuming = false;

  function autoMount() {
    try {
      if (S.panel || resuming) return;
      // Closed by you on this page: stay closed until the address changes.
      if (S.dismissedAt === location.href) return;
      // An embedded form already has the panel; the page around it gets none.
      if (isTop && childOwnsPanel) return;
      if (!looksLikeApplication()) return;
      claimFrame(window.__screenmateScan.scanFields().length);
    } catch {
      /* never let detection break the host page */
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== "screenmate:toggle" && msg?.type !== "screenmate:open") return;
    // Opened by hand: whichever frame actually holds a form takes it. The top
    // frame is the fallback, unless an embedded form already owns the panel —
    // mounting there too would put two panels on the page.
    try {
      if (S.panel) {
        if (msg.type === "screenmate:toggle") S.panel.toggle();
        else S.panel.toggle(false);
        return;
      }
      const mine = isTop ? !childOwnsPanel : looksLikeApplication();
      if (mine) {
        S.dismissedAt = null;
        void mount();
      }
    } catch {
      /* ignore */
    }
  });

  window.__screenmateMount = mount;

  /**
   * Application forms on single-page sites appear after load: Ashby's and
   * Rippling's show theirs when you press Apply, with no page load at all.
   * So detection runs again whenever the page settles after a change, at most
   * every couple of seconds, until a panel is up.
   */
  let settleTimer = null;
  let lastCheck = 0;
  const observer = new MutationObserver(() => {
    if (S.panel || resuming || document.hidden) return;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      // A busy page (a feed, a chat) mutates constantly; look at most every 3s.
      if (Date.now() - lastCheck < 3000) return;
      lastCheck = Date.now();
      autoMount();
    }, 800);
  });

  async function boot() {
    // A run that crossed a full page load resumes here, in whichever frame
    // holds the site it was working on.
    const saved = await message({ type: "screenmate:loadRun" });
    if (saved) {
      resuming = true;
      try {
        await resumeRun(saved);
      } finally {
        resuming = false;
      }
      return;
    }
    autoMount();
    setTimeout(autoMount, 1500);
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
  }

  void boot();
})();
