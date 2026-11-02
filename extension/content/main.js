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

  const STEP_DELAY = 380;
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
    autoResume: false,
    status: "idle",
    context: {},
    fields: [],
    goal: null,
    steps: [],
    activity: [],
    research: null,
    approvalQueue: [],
    changes: [],
    report: null,
    banner: null,
    profile: null,
    step: 1,
    pages: [],
    observedSig: null,
    lastObservationLog: null,
    submitHandoff: null,
    navigationIssue: null,
    prefs: {},
    needsPrefs: false,
    /** Sensitive fields already settled this run — prevents re-asking forever. */
    resolvedSensitive: new Set(),
    deferredDropdowns: new Set(),
    stats: EMPTY_STATS(),
  };

  /* ---------------- plumbing ---------------- */

  const api = (route, body) =>
    new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "screenmate:api", route, body }, (r) =>
        resolve(r || { ok: false, error: "Extension messaging failed" }),
      );
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

  function paint(autoscroll = false) {
    S.panel?.render({
      context: S.context,
      status: S.status,
      goal: S.goal,
      steps: S.steps,
      activity: S.activity.slice(-60),
      research: S.research,
      approval: S.approvalQueue[0] || null,
      changes: S.changes,
      report: S.report,
      stats: S.stats,
      banner: S.banner,
      counts: S.fields.length ? counts() : null,
      step: S.step,
      pages: S.pages,
      submitHandoff: S.submitHandoff,
      needsPrefs: S.needsPrefs,
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
  async function observe(gen = S.gen) {
    await refreshParentContext();
    if (stale(gen)) return false;
    const signatureBefore = window.__screenmateScan.pageSignature();
    const scanned = window.__screenmateScan.scanFields();
    const nextContext = window.__screenmateScan.pageContext();
    const sameContextText = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
    if (S.context.company && S.context.jobTitle &&
      (!sameContextText(S.context.company, nextContext.company) || !sameContextText(S.context.jobTitle, nextContext.jobTitle))) {
      // A client-side route can move to another job without replacing this
      // content script. Reuse research across steps, never across employers or roles.
      S.research = null;
      S.goal = null;
    }
    S.context = nextContext;

    if (scanned.length === 0) {
      S.fields = [];
      log("warn", "No form fields on this step", "Nothing for the agent to do here.");
      return false;
    }

    const res = await api("classify", {
      fields: scanned.map((f) => ({
        id: f.id,
        label: f.label,
        type: f.type,
        required: f.required,
        options: f.options,
        maxLength: f.maxLength,
        instructions: f.instructions,
      })),
    });

    if (stale(gen) || signatureBefore !== window.__screenmateScan.pageSignature()) return false;
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
      autocomplete: byId.get(f.id)?.autocomplete,
      inputType: byId.get(f.id)?.inputType,
      context: byId.get(f.id)?.context,
      maxLength: byId.get(f.id)?.maxLength,
      instructions: byId.get(f.id)?.instructions,
      ...f,
      el: byId.get(f.id)?.el,
      value: byId.get(f.id)?.el ? window.__screenmateScan.currentValue(byId.get(f.id).el) : "",
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
          maxLength: f.maxLength,
          instructions: f.instructions,
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

  async function runResearch(gen = S.gen) {
    if (S.research) {
      log("think", "Research reused", "Context for this company is already loaded.");
      markStep("research", "done");
      return;
    }
    setStatus("researching");
    markStep("research", "active");
    const res = await api("research", {
      company: S.context.company,
      role: S.context.jobTitle,
      roleId: S.context.url,
    });
    if (stale(gen)) return;
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

  async function queueApproval(field, reason) {
    if (!window.__screenmateAct.canAutomate(field) || (field.value || '').trim()) return;
    // Dropdowns should not interrupt the application. A missing personal answer
    // stays visibly incomplete for final review rather than being fabricated.
    if (field.type === 'select') {
      if ((field.value || '').trim() || S.resolvedSensitive.has(field.id)) return;
      const key = `${S.step}:${field.id}`;
      if (!S.deferredDropdowns.has(key)) {
        S.deferredDropdowns.add(key);
        log('warn', `${field.label} left for review`, reason || field.sensitiveReason || 'No matching profile value or saved answer.');
      }
      return;
    }
    if (S.resolvedSensitive.has(field.id)) return;
    if (S.approvalQueue.some((a) => a.fieldId === field.id)) return;

    S.approvalQueue.push({
      fieldId: field.id,
      label: field.label,
      reason: field.sensitiveReason || reason || "",
      options: null,
      topic: field.topic || null,
      free: true,
    });
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
      refreshValues();
      if (!window.__screenmateAct.canAutomate(field)) continue;
      // Any field the policy recognised as a standing-answer question, whether
      // or not it also tripped the sensitive list.
      if (!field.topic) continue;
      if ((field.value || "").trim()) continue;
      if (S.resolvedSensitive.has(field.id)) continue;

      // Resolve against the widget's real choices, not a guess.
      if (field.type === "select" && !field.options?.length) {
        const discovered = await window.__screenmateAct.readOptions(field, { query: window.__screenmatePrefs.queryFor(field, S.profile, S.prefs) });
        if (discovered.length) field.options = discovered;
      }
      if (stale(gen)) return handled;
      const hit = window.__screenmatePrefs.resolve(field, S.prefs);
      if (!hit) continue;

      const res = await window.__screenmateAct.applyWrite(field, hit.value, { automatic: true });
      if (stale(gen)) return handled;
      if (!res.ok) {
        log(
          "warn",
          `Your saved answer does not fit ${field.label}`,
          `${res.reason} — handing it to you.`,
        );
        await queueApproval(field, "Your standing answer had no match here.");
        continue;
      }
      window.__screenmateAct.highlight(field.el);
      const check = window.__screenmateAct.verifyWrite(field, hit.value);
      field.value = check.actual;
      if (check.ok) S.resolvedSensitive.add(field.id);
      else await queueApproval(field, 'The saved answer could not be verified.');
      S.stats.userDecisions += 1;
      if (check.ok) S.stats.verifiedActions += 1;

      S.changes.push({
        fieldId: field.id,
        label: field.label,
        before: "",
        after: hit.value,
        verified: check.ok,
        level: field.level,
        step: S.step,
        fromPreference: true,
      });

      log(
        "prefs",
        `${field.label} answered from your saved preference`,
        `"${hit.value}" — your standing answer, not the agent's judgement.`,
      );
      handled += 1;
      await sleep(240);
      if (stale(gen)) return handled;
    }
    return handled;
  }

  async function prepareDropdowns(gen) {
    for (const field of S.fields) {
      if (stale(gen)) return;
      refreshValues();
      if (!window.__screenmateAct.canAutomate(field) || (field.value || '').trim()) continue;
      // A question about skills or education needs an answer to the question,
      // not a bare copied skill list or degree merely because its label matches.
      if (field.narrative) continue;
      let match = window.__screenmatePrefs.resolveProfile(field, S.profile);
      if (field.type === 'select' && !match) {
        const query = window.__screenmatePrefs.queryFor(field, S.profile, S.prefs);
        const options = await window.__screenmateAct.readOptions(field, { query });
        if (options.length) field.options = options;
        match = window.__screenmatePrefs.resolveProfile(field, S.profile);
      }
      if (stale(gen)) return;
      if (match) await applyAction({
        tool: field.type === 'select' ? 'selectOption' : 'fillField',
        args: { fieldId: field.id, value: match.value }, rationale: match.reason,
      }, gen);
      if (S.observedSig !== window.__screenmateScan.pageSignature()) return;
    }
  }

  async function applyAction(action, gen) {
    if (stale(gen)) return;
    refreshValues();
    const field = S.fields.find((f) => f.id === action.args?.fieldId);
    if (!field) {
      log("warn", `Unknown field "${action.args?.fieldId}" ignored`);
      return;
    }

    if ((field.value || '').trim() || !window.__screenmateAct.canAutomate(field)) return;
    if (action.tool === "requestUserApproval") {
      await queueApproval(field, action.args.reason);
      if (field.type !== 'select') {
        log("lock", `${field.label} requires user input`, field.sensitiveReason);
        markStep("approval", "active");
      }
      return;
    }

    // Client-side backstop. The server already rewrites these; the tool layer
    // refuses independently — the same three-layer guarantee as the web app.
    if (field.sensitive) {
      log("lock", `Blocked: ${field.label} is user-only`, "Requesting your decision.");
      await queueApproval(field);
      return;
    }

    const value = (action.args?.value || "").trim();
    if (!value) return;

    const before = field.value || "";
    const written = await window.__screenmateAct.applyWrite(field, value, { automatic: true });
    if (stale(gen)) return;
    if (!written.ok) {
      log("warn", `Could not write ${field.label}`, written.reason);
      return;
    }
    window.__screenmateAct.highlight(field.el);
    const change = {
      fieldId: field.id, label: field.label, before, after: value,
      verified: window.__screenmateAct.verifyWrite(field, value).ok,
      level: field.level, step: S.step,
      regenerable: field.narrative === true && !field.sensitive,
      maxLength: field.maxLength,
    };
    S.changes.push(change);
    log(
      "write",
      `${field.label} completed`,
      value.length > 90 ? `${value.slice(0, 89)}…` : value,
    );

    setStatus("verifying");
    await sleep(200);
    if (stale(gen)) return;

    let check = window.__screenmateAct.verifyWrite(field, value);
    if (!check.ok) {
      log("warn", "Verification failed — retrying once", check.summary, true);
      if (!window.__screenmateAct.canAutomate(field)) return;
      await window.__screenmateAct.applyWrite(field, value, { automatic: true });
      await sleep(240);
      if (stale(gen)) return;
      check = window.__screenmateAct.verifyWrite(field, value);
    }

    field.value = check.actual;
    if (check.ok) S.stats.verifiedActions += 1;
    if (field.level === "review") S.stats.reviewedSuggestions += 1;
    else S.stats.safeFields += 1;

    change.verified = check.ok;

    log(
      check.ok ? "verify" : "warn",
      check.ok ? "Field update confirmed" : `Verification failed — ${check.summary}`,
      check.checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.label}`).join("  ·  "),
      true,
    );
    setStatus("acting");
  }

  function hasModelWork() {
    return S.fields.some(field => !field.sensitive && !(field.value || '').trim() &&
      field.type !== 'file' && window.__screenmateAct.canAutomate(field) &&
      (field.type !== 'select' || field.options?.length));
  }

  async function runPass(gen) {
    refreshValues();
    const signature = window.__screenmateScan.pageSignature();
    if (S.observedSig !== signature) return 'changed';
    if (!hasModelWork()) {
      for (const field of S.fields) {
        if (field.sensitive && field.type !== 'file' && field.required && !(field.value || '').trim()) await queueApproval(field);
      }
      if (signature !== window.__screenmateScan.pageSignature()) return 'changed';
      if (S.approvalQueue.length) { setStatus('waiting'); return 'waiting'; }
      return 'done';
    }
    setStatus("planning");
    const res = await api("agent", payload("act"));
    if (stale(gen)) return "stale";
    if (signature !== window.__screenmateScan.pageSignature()) return "changed";
    if (!res.ok) {
      failAgent(res);
      return "error";
    }
    if (stale(gen)) return "stale";

    const plan = res.data;
    log("think", "Decision", plan.decisionSummary);
    if (plan.dropped?.length) {
      log(
        "warn",
        `${plan.dropped.length} ungrounded write${plan.dropped.length === 1 ? "" : "s"} discarded`,
        "Values were not present in your profile.",
      );
    }

    setStatus("acting");
    markStep("fill", "active");
    for (const action of plan.actions) {
      await sleep(STEP_DELAY);
      if (stale(gen)) return "stale";
      if (signature !== window.__screenmateScan.pageSignature()) return "changed";
      if (action.tool === "researchCompany") {
        await runResearch(gen);
        continue;
      }
      await applyAction(action, gen);
    }
    // The last action can reveal a dependent question too. Reclassify it
    // before validation or navigation, even when no old field remains open.
    if (signature !== window.__screenmateScan.pageSignature()) return 'changed';
    markStep("fill", "done");

    if (S.approvalQueue.length) {
      setStatus("waiting");
      return "waiting";
    }
    return "done";
  }

  /* ---------------- validation ---------------- */

  function refreshValues() {
    const live = new Map(window.__screenmateScan.scanFields().map(field => [field.id, field]));
    for (const field of S.fields) {
      const current = live.get(field.id);
      if (current?.label === field.label && current.type === field.type) {
        field.el = current.el;
        field.value = current.value;
        field.required = current.required;
        if (current.el.tagName === 'SELECT' || current.el.type === 'radio') field.options = current.options;
        field.autocomplete = current.autocomplete;
        field.inputType = current.inputType;
        field.context = current.context;
        field.maxLength = current.maxLength;
        field.instructions = current.instructions;
      }
    }
    S.approvalQueue = S.approvalQueue.filter(req => {
      const field = S.fields.find(field => field.id === req.fieldId);
      return field && !(field.value || '').trim() && window.__screenmateAct.canAutomate(field);
    });
  }

  function validate() {
    refreshValues();
    const open = S.fields.filter((f) => f.required && !(f.value || "").trim());
    const sensitiveOpen = open.filter((f) => f.sensitive);
    const badUrl = S.fields.filter(
      (f) => f.type === "url" && f.value && !/^https?:\/\/\S+\.\S{2,}/i.test(f.value),
    );
    const badEmail = S.fields.filter(
      (f) => f.type === "email" && f.value && !/^\S+@\S+\.\S{2,}$/.test(f.value),
    );
    const unverified = S.changes.filter((c) => !c.verified);
    // Read validity without checkValidity(): that method dispatches invalid
    // events and can trigger a site's error UI while we are only inspecting.
    const invalid = S.fields.filter((f) => ((f.value || '').trim() || f.required) &&
      (f.el?.getAttribute?.('aria-invalid') === 'true' ||
        (f.el?.willValidate !== false && f.el?.validity?.valid === false)));
    const blockers = new Map();
    const addBlocker = (fieldId, message) => {
      if (!blockers.has(fieldId)) blockers.set(fieldId, { fieldId, message });
    };
    for (const field of open) addBlocker(field.id, `${field.label} is required.`);
    for (const field of badEmail) addBlocker(field.id, `${field.label} needs a valid email address.`);
    for (const field of badUrl) addBlocker(field.id, `${field.label} needs a valid website URL.`);
    for (const field of invalid) {
      const detail = String(field.el?.validationMessage || '').trim().slice(0, 180);
      addBlocker(field.id, `${field.label}: ${detail || 'The application reports an invalid value.'}`);
    }
    for (const change of unverified) {
      addBlocker(change.fieldId, `${change.label} could not be verified${change.step !== S.step ? ` on step ${change.step}` : ''}. Review it on the application form.`);
    }
    if (S.navigationIssue) {
      if (S.navigationIssue.signature === window.__screenmateScan.pageSignature()) {
        addBlocker('__navigation__', S.navigationIssue.message);
      } else S.navigationIssue = null;
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
        { id: "site-validity", label: "No field validation errors", ok: invalid.length === 0,
          detail: invalid.length ? `${invalid.length} fields need attention` : undefined },
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

  function reviewBanner(report) {
    const requiredOnly = report.blockers.every(blocker => / is required\.$/.test(blocker.message));
    const lead = requiredOnly ? 'Some required fields still need your input.' : 'The application still needs your attention.';
    return `${lead} ${report.blockers.slice(0, 3).map(blocker => blocker.message).join(' ')}`;
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
        if (!(await observe(gen))) {
          if (stale(gen)) return 'stale';
          if (sig !== window.__screenmateScan.pageSignature()) continue;
          return "error";
        }
        S.observedSig = window.__screenmateScan.pageSignature();
        await sleep(STEP_DELAY);
        if (stale(gen)) return "stale";

        // Discover real choices before the model sees this step, and fill
        // unambiguous factual choices directly from the stored profile.
        await prepareDropdowns(gen);
        if (stale(gen)) return 'stale';
        if (S.observedSig !== window.__screenmateScan.pageSignature()) continue;
        await applyPreferences(gen);
        if (stale(gen)) return 'stale';

        // Plan per step: each page of a wizard asks for different things.
        setStatus("planning");
        const res = hasModelWork() ? await api("agent", payload("plan")) : {
          ok: true, data: {
            goal: 'Complete this application from your saved details',
            observation: 'Known fields filled and verified. Checking what still needs your input.',
            researchNeeded: false, researchRationale: 'No open answer needs company research.',
            steps: [{ kind: 'fill', label: 'Fill saved details' }, { kind: 'validate', label: 'Check the application' }, { kind: 'review', label: 'Review changes' }],
          },
        };
        if (stale(gen)) return 'stale';
        if (S.observedSig !== window.__screenmateScan.pageSignature()) continue;
        if (!res.ok) {
          failAgent(res);
          return "error";
        }
        if (stale(gen)) return "stale";

        const plan = res.data;
        if (!S.goal) S.goal = plan.goal;
        S.steps = plan.steps.map((s) => ({ ...s, status: "pending" }));
        log("observe", "Observation", plan.observation);
        markStep("observe", "done");

        if (plan.researchNeeded) {
          log("research", "Research required", plan.researchRationale);
          await runResearch(gen);
        } else {
          log("think", "Context check", plan.researchRationale);
          markStep("research", "skipped");
        }
        await sleep(STEP_DELAY);
      }

      const fromPrefs = await applyPreferences(gen);
      if (fromPrefs) {
        log(
          "success",
          `${fromPrefs} sensitive field${fromPrefs === 1 ? "" : "s"} filled from your preferences`,
          "Set once, applied on every site.",
        );
      }
      if (stale(gen)) return "stale";

      let outcome = 'done';
      // Continue only while a batch makes verified progress. Large forms are
      // not limited to two batches; unknown answers cannot cause an AI loop.
      for (let batch = 0; batch < 12; batch++) {
        const before = S.stats.verifiedActions;
        outcome = await runPass(gen);
        if (outcome !== 'done' || !hasModelWork() || S.stats.verifiedActions === before) break;
      }
      if (outcome === 'changed') continue;
      if (outcome !== "done") return outcome;
      if (stale(gen)) return 'stale';

      recordPage();
      S.report = validate();
      markStep("validate", "done");

      /* --- advance, or stop --- */
      if (window.__screenmateAct.isEditing()) break;
      if (S.report.blockers.length) break;
      const next = window.__screenmateNav.findAdvanceControl();
      if (!next) {
        const navigationProblem = window.__screenmateNav.navigationProblem?.();
        if (navigationProblem) {
          S.navigationIssue = { signature: window.__screenmateScan.pageSignature(), message: navigationProblem };
          log('warn', 'Application navigation needs your input', navigationProblem);
          break;
        }
        S.submitHandoff = window.__screenmateNav.findSubmitControl();
        break;
      }
      if (S.step >= MAX_STEPS) {
        log("warn", "Step limit reached", `Stopped after ${MAX_STEPS} steps.`);
        S.navigationIssue = { signature: window.__screenmateScan.pageSignature(),
          message: `Step ${S.step} is not the final step. Continue on the application form, then run SCREENMATE again.` };
        break;
      }

      setStatus("advancing");
      log("nav", `Advancing to step ${S.step + 1}`, `Clicking "${next.text}"`);
      const moved = await window.__screenmateNav.advance(next, { cancelled: () => stale(gen) });
      if (stale(gen)) return 'stale';
      if (!moved.ok) {
        log("warn", "Could not advance", moved.reason);
        S.navigationIssue = { signature: window.__screenmateScan.pageSignature(),
          message: `Could not continue from step ${S.step}: ${moved.reason || 'Check the application form and continue manually.'}` };
        break;
      }
      S.step += 1;
      S.observedSig = null;
      await sleep(STEP_DELAY);
    }

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

    if (S.submitHandoff) {
      log(
        "lock",
        "Submission is yours",
        `SCREENMATE stops here. "${S.submitHandoff.text}" is the one button it will never press.`,
      );
    }

    if (S.changes.length || blockers) {
      if (blockers) S.banner = reviewBanner(S.report);
      markStep("review", "active");
      setStatus("reviewing");
      return;
    }
    setStatus("complete");
  }

  /* ---------------- run ---------------- */

  async function setPref(topic, value) {
    S.prefs = await window.__screenmatePrefs.setOne(topic, value);
    paint();
  }

  /**
   * Standing answers are optional configuration, not a gate before each run.
   */
  async function startRun() {
    const info = await new Promise(resolve => chrome.runtime.sendMessage({ type: 'screenmate:getProfile' }, resolve));
    S.profile = info?.profile || S.profile || {};
    if (!info?.profileConfigured) {
      S.autoResume = false;
      S.banner = "Add and save your own name and email in the SCREENMATE popup before running on a job application.";
      log("warn", "Your profile needs setup", "Open the extension popup, review your details, and choose Save profile.");
      paint();
      return;
    }
    S.prefs = await window.__screenmatePrefs.load();
    S.needsPrefs = false;
    S.autoResume = true;
    void run();
  }

  async function run() {
    if (S.running) return;
    S.running = true;
    const gen = S.gen;
    S.banner = null;
    S.navigationIssue = null;
    S.observedSig = null;

    try {
      await pageLoop(gen);
    } finally {
      S.running = false;
    }
  }

  /* ---------------- user actions ---------------- */

  async function answer(value, remember = true) {
    const req = S.approvalQueue[0];
    if (!req) return;
    const field = S.fields.find((f) => f.id === req.fieldId);

    if (field) {
      const res = await window.__screenmateAct.applyWrite(field, value);
      if (res.ok) {
        window.__screenmateAct.highlight(field.el);
        field.value = window.__screenmateAct.verifyWrite(field, value).actual;
      } else {
        log("warn", `Could not write your answer to ${field.label}`, res.reason);
      }
    }
    S.stats.userDecisions += 1;
    S.resolvedSensitive.add(req.fieldId);
    S.approvalQueue.shift();
    log(
      "success",
      `${req.label} answered by you`,
      `"${value}" — your decision, not the agent's.`,
    );

    // Offer to remember it, so this question never interrupts a run again.
    if (req.topic && remember && window.__screenmatePrefs.canReuseAnswer({ ...field, topic: req.topic, label: req.label })) {
      S.prefs = await window.__screenmatePrefs.setOne(req.topic, value);
      log("prefs", "Saved as a standing answer", `Applied automatically from now on.`);
    }

    if (S.approvalQueue.length) return paint();
    markStep("approval", "done");

    if (S.running) return;
    S.running = true;
    const gen = S.gen;
    setStatus("acting");
    try {
      await sleep(STEP_DELAY);
      if (stale(gen)) return;
      // The page signature is unchanged, so the loop resumes on this same step.
      await pageLoop(gen);
    } finally {
      S.running = false;
    }
  }

  /** Leaves an optional sensitive question blank and moves on. */
  function skipApproval() {
    const req = S.approvalQueue.shift();
    if (!req) return;
    S.resolvedSensitive.add(req.fieldId);
    log("lock", `${req.label} left blank`, "You chose not to answer it.");
    if (S.approvalQueue.length) return paint();
    markStep("approval", "done");
    if (S.running) return;
    S.running = true;
    const gen = S.gen;
    setStatus("acting");
    void (async () => {
      try {
        await sleep(STEP_DELAY);
        if (!stale(gen)) await pageLoop(gen);
      } finally {
        S.running = false;
      }
    })();
  }

  /** Writes a user-corrected value straight to the page. */
  async function editChange(fieldId, value) {
    const field = S.fields.find((f) => f.id === fieldId);
    const change = S.changes.find((c) => c.fieldId === fieldId);
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
    const check = window.__screenmateAct.verifyWrite(field, text);
    field.value = check.actual;
    window.__screenmateAct.keepField(field);

    if (change) {
      change.after = text;
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
    if (!field || !field.narrative || field.sensitive) return;

    S.running = true;
    const gen = S.gen;
    const previous = S.status;
    const signature = window.__screenmateScan.pageSignature();
    setStatus("acting");
    try {
      log("think", `Rewriting ${field.label}`, "Producing a different angle.");
      const res = await api("agent", payload("regenerate", { targetFieldId: fieldId }));
      if (stale(gen) || signature !== window.__screenmateScan.pageSignature()) return;
      if (!res.ok) {
        log("warn", "Regeneration unavailable", res.reason || res.error);
        return;
      }
      const value = res.data?.value;
      if (!value) return;

      const w = await window.__screenmateAct.applyWrite(field, value);
      if (stale(gen)) return;
      if (!w.ok) {
        log("warn", `Could not write the new answer to ${field.label}`, w.reason);
        return;
      }
      window.__screenmateAct.highlight(field.el);
      const check = window.__screenmateAct.verifyWrite(field, value);
      field.value = check.actual;

      const change = S.changes.find((c) => c.fieldId === fieldId);
      if (change) {
        change.after = value;
        change.verified = check.ok;
      }
      log("write", `${field.label} rewritten`, value.slice(0, 90));
      if (res.data.note) log("think", "What changed", res.data.note, true);
    } finally {
      S.running = false;
      if (!stale(gen)) {
        setStatus(previous === "idle" ? "reviewing" : previous);
      }
    }
  }

  /** Puts one field back to whatever it held before the agent touched it. */
  async function revertOne(fieldId) {
    const field = S.fields.find((f) => f.id === fieldId);
    const change = S.changes.find((c) => c.fieldId === fieldId && c.label === field?.label && c.step === S.step);
    if (!change || !field) return;

    const restored = await window.__screenmateAct.applyWrite(field, change.before || '');
    const actual = window.__screenmateScan.currentValue(field.el);
    if (!restored.ok || actual !== (change.before || '')) {
      log('warn', `${change.label} could not be reverted`, restored.reason || 'The form did not restore the original value.');
      paint();
      return;
    }
    field.value = actual;
    window.__screenmateAct.keepField(field);
    S.changes = S.changes.filter((c) => c !== change);
    S.resolvedSensitive.add(fieldId);
    log("warn", `${change.label} reverted`, "Put back to what it was.");
    S.report = validate();
    paint();
  }

  async function revertAll() {
    const reverted = new Set();
    for (const c of S.changes) {
      const field = S.fields.find((f) => f.id === c.fieldId && f.label === c.label && c.step === S.step);
      if (field) {
        const restored = await window.__screenmateAct.applyWrite(field, c.before || '');
        const actual = window.__screenmateScan.currentValue(field.el);
        if (restored.ok && actual === (c.before || '')) {
          field.value = actual;
          window.__screenmateAct.keepField(field);
          reverted.add(c);
        } else log('warn', `${c.label} could not be reverted`, restored.reason || 'Restore it directly on the form.');
      }
    }
    log(
      "warn",
      `${reverted.size} change${reverted.size === 1 ? '' : 's'} reverted on this step`,
      "Earlier steps are left as they are — navigate back to change those.",
    );
    S.changes = S.changes.filter((c) => !reverted.has(c));
    S.report = validate();
    S.banner = S.report.blockers.length ? reviewBanner(S.report) : null;
    setStatus(S.changes.length || S.report.blockers.length ? 'reviewing' : 'complete');
  }

  function acceptAll() {
    S.autoResume = false;
    log("success", "All changes accepted", `${S.changes.length} fields confirmed.`);
    S.report = validate();
    if (S.report.blockers.length) {
      S.banner = reviewBanner(S.report);
      markStep("review", "active");
      setStatus("reviewing");
      return;
    }
    S.banner = null;
    markStep("review", "done");
    setStatus("complete");
  }

  function reset() {
    S.autoResume = false;
    S.gen += 1;
    S.running = false;
    Object.assign(S, {
      status: "idle",
      goal: null,
      steps: [],
      activity: [],
      research: null,
      approvalQueue: [],
      changes: [],
      report: null,
      banner: null,
      step: 1,
      pages: [],
      observedSig: null,
      lastObservationLog: null,
      submitHandoff: null,
      navigationIssue: null,
      needsPrefs: false,
      resolvedSensitive: new Set(),
      deferredDropdowns: new Set(),
      stats: EMPTY_STATS(),
    });
    void observe().then(() => {
      S.observedSig = window.__screenmateScan.pageSignature();
      paint();
    });
  }

  /* ---------------- boot ---------------- */

  let mounting = null;
  async function mount(options = {}) {
    if (mounting) {
      await mounting;
      if (!options.collapsed) S.panel?.toggle(false);
      return;
    }
    mounting = mountPanel(options);
    try { await mounting; } finally { mounting = null; }
  }

  async function mountPanel({ collapsed = false } = {}) {
    if (S.panel) {
      S.panel.toggle(false);
      return;
    }
    const info = await new Promise((r) =>
      chrome.runtime.sendMessage({ type: "screenmate:getProfile" }, r),
    );
    S.profile = info?.profile || {};
    S.prefs = await window.__screenmatePrefs.load();

    S.panel = new window.__screenmatePanel(
      {
        onRun: () => void startRun(),
        onRescan: () => reset(),
        onAnswer: (v, remember) => void answer(v, remember),
        onSkip: () => skipApproval(),
        onSetPref: (topic, value) => void setPref(topic, value),
        onPrefsDone: async (freeValues = {}) => {
          for (const [topic, value] of Object.entries(freeValues)) {
            if (value) S.prefs = await window.__screenmatePrefs.setOne(topic, value);
          }
          S.prefs = await window.__screenmatePrefs.load();
          S.needsPrefs = false;
          void startRun();
        },
        onEditPrefs: () => {
          S.needsPrefs = true;
          paint();
        },
        onAcceptAll: () => acceptAll(),
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
          S.autoResume = false;
          S.gen++;
          S.panel.remove();
          S.panel = null;
        },
      },
      { collapsed },
    );

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
    const fields = window.__screenmateScan.scanFields();
    if (fields.length < 2) return false;
    const text = fields.map((f) => f.label.toLowerCase()).join(" ");
    const hasIdentity = /name|email/.test(text);
    if (!hasIdentity) return false;

    // A wizard's first step is often short, so an advance control counts as
    // evidence of depth alongside the usual application vocabulary.
    const jobWords =
      /resume|cover|why|experience|portfolio|linkedin|degree|school|salary|sponsor|employer|position/;
    const hasAdvance = Boolean(window.__screenmateNav?.findAdvanceControl());
    const applicationContext = /apply|application|careers|jobs/.test(`${location.pathname} ${document.title}`.toLowerCase());
    return jobWords.test(text) || (fields.length >= 4 && hasAdvance) || (applicationContext && hasAdvance);
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
  // WindowProxy survives an iframe navigation, so also identify its document.
  const frameDocument = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let electionTimer = null;
  const claims = new Map();
  let electionWinner = null;
  let winnerDocument = null;
  let manualOpenPending = false;
  let parentRequest = null;
  let parentRequestSerial = 0;
  let lastSharedContext = '';

  function sendFrameContext(source, kind, documentId, requestId) {
    const context = window.__screenmateScan.contextForMessage?.() || null;
    source.postMessage({ __screenmate: kind, documentId, requestId, context }, '*');
    if (source === electionWinner) lastSharedContext = JSON.stringify(context);
  }

  function refreshParentContext() {
    if (isTop || !window.__screenmateScan.setParentContext) return Promise.resolve();
    // Refresh before classification/planning. A reused frame must not retain
    // the previous posting when its parent navigates to another job.
    if (parentRequest) parentRequest.finish();
    window.__screenmateScan.setParentContext(null);
    return new Promise(resolve => {
      const requestId = `${frameDocument}-${++parentRequestSerial}`;
      const finish = () => {
        if (parentRequest?.requestId === requestId) {
          clearTimeout(parentRequest.timer);
          parentRequest = null;
        }
        resolve();
      };
      parentRequest = { requestId, finish, timer: setTimeout(finish, 500) };
      try { window.top.postMessage({ __screenmate: 'screenmate:contextRequest', documentId: frameDocument, requestId }, '*'); }
      catch { finish(); }
    });
  }

  function publishChangedContext() {
    if (!isTop || !electionWinner || electionWinner === window) return;
    pruneClaims();
    if (!electionWinner) return;
    const context = window.__screenmateScan.contextForMessage?.() || null;
    if (JSON.stringify(context) !== lastSharedContext) {
      try { sendFrameContext(electionWinner, 'screenmate:parentContext', winnerDocument); } catch { /* Removed frame. */ }
    }
  }

  function childFrames(root = window) {
    const found = [];
    try {
      for (let i = 0; i < root.frames.length; i++) {
        const child = root.frames[i];
        found.push(child, ...childFrames(child));
      }
    } catch { /* A removed or restricted frame cannot be elected. */ }
    return found;
  }

  function pruneClaims() {
    const attached = new Set([window, ...childFrames()]);
    for (const source of claims.keys()) if (!attached.has(source)) claims.delete(source);
    if (electionWinner && !attached.has(electionWinner)) {
      electionWinner = null;
      winnerDocument = null;
    }
    return attached;
  }

  function announceWinner(source, documentId) {
    electionWinner = source;
    winnerDocument = documentId;
    const expanded = manualOpenPending;
    manualOpenPending = false;
    if (source === window) void mount({ collapsed: !expanded });
    else {
      try {
        sendFrameContext(source, expanded ? 'screenmate:openWinner' : 'screenmate:youWon', documentId);
      } catch { electionWinner = null; winnerDocument = null; }
    }
  }

  function claimFrame(count, manual = false) {
    const msg = { __screenmate: ELECTION, count, href: location.href, documentId: frameDocument, manual };
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
      if (d?.__screenmate === 'screenmate:contextRequest') {
        if (ev.source === window || !pruneClaims().has(ev.source) || typeof d.documentId !== 'string' || d.documentId.length > 120 ||
          typeof d.requestId !== 'string' || d.requestId.length > 160) return;
        try { sendFrameContext(ev.source, 'screenmate:parentContext', d.documentId, d.requestId); } catch { /* Removed frame. */ }
        return;
      }
      if (!d || d.__screenmate !== ELECTION) return;
      if (!ev.source || !Number.isFinite(d.count) || d.count < (d.manual ? 1 : 2) || typeof d.documentId !== 'string') return;
      if (!pruneClaims().has(ev.source)) return;
      claims.set(ev.source, { count: d.count, source: ev.source, documentId: d.documentId });
      if (electionWinner) {
        // The same iframe can now contain a new document without changing its
        // WindowProxy. Let that document reacquire the panel after navigation.
        if (electionWinner === ev.source && winnerDocument !== d.documentId) announceWinner(ev.source, d.documentId);
        return;
      }
      clearTimeout(electionTimer);
      // Wait a beat for slower frames before deciding.
      electionTimer = setTimeout(() => {
        pruneClaims();
        if (!claims.size) return;
        const winner = [...claims.values()].reduce((a, b) => (b.count > a.count ? b : a));
        announceWinner(winner.source, winner.documentId);
      }, 600);
    });
  }

  window.addEventListener("message", (ev) => {
    if (ev.source !== window.top) return;
    const data = ev.data;
    if (['screenmate:youWon', 'screenmate:openWinner', 'screenmate:parentContext'].includes(data?.__screenmate)) {
      if (data.documentId !== frameDocument) return;
      if (data.requestId && data.requestId !== parentRequest?.requestId) return;
      const before = window.__screenmateScan.pageContext();
      const accepted = window.__screenmateScan.setParentContext?.(data.context);
      if (data.requestId) parentRequest?.finish();
      else if (accepted && S.panel && JSON.stringify(before) !== JSON.stringify(window.__screenmateScan.pageContext())) adaptToPage();
    }
    if (data?.__screenmate === "screenmate:youWon" && !S.panel) {
      void mount({ collapsed: true });
    }
    if (data?.__screenmate === 'screenmate:openWinner') void mount();
    if (data?.__screenmate === "screenmate:identifyFrame") {
      const count = window.__screenmateScan.scanFields().length;
      if (count) claimFrame(count, true);
    }
  });

  function autoMount() {
    try {
      if (S.panel) return;
      if (document.querySelector('[data-screenmate-workspace]')) return;
      const fields = window.__screenmateScan.scanFields();
      if (!looksLikeApplication()) return;
      claimFrame(fields.length);
    } catch {
      /* never let detection break the host page */
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== "screenmate:toggle" && msg?.type !== "screenmate:open") return;
    // Only the top frame routes a manual open; broadcasting must not mount
    // another panel in every iframe that contains an application.
    if (!isTop) return;
    try {
      pruneClaims();
      const openWinner = () => {
        pruneClaims();
        manualOpenPending = false;
        if (electionWinner && electionWinner !== window) {
          sendFrameContext(electionWinner, 'screenmate:openWinner', winnerDocument);
        } else void mount();
      };
      if (electionWinner || S.panel) openWinner();
      else {
        manualOpenPending = true;
        // A short first step may not satisfy auto-detection. An explicit Open
        // asks every attached frame to identify even a one-field form.
        for (const frame of [window, ...childFrames()]) {
          try { frame.postMessage({ __screenmate: "screenmate:identifyFrame" }, "*"); } catch { /* removed frame */ }
        }
        setTimeout(() => { if (manualOpenPending) openWinner(); }, 800);
      }
    } catch {
      /* ignore */
    }
  });

  window.__screenmateMount = mount;
  window.addEventListener('popstate', publishChangedContext);

  // Real user events invalidate outstanding plans before the next write. Wait
  // until interaction settles and the previous loop exits, then classify anew.
  let resumeTimer = null;
  function adaptToPage() {
    if (!S.panel || !S.autoResume) return;
    S.gen++;
    S.observedSig = null;
    S.report = null;
    S.submitHandoff = null;
    setStatus('adapting');
    clearTimeout(resumeTimer);
    const resume = async () => {
      if (!S.autoResume || !S.panel) return;
      if (S.running) { resumeTimer = setTimeout(resume, 200); return; }
      if (!window.__screenmateScan.scanFields().length) return;
      S.resolvedSensitive.clear();
      S.deferredDropdowns.clear();
      refreshValues();
      await run();
    };
    resumeTimer = setTimeout(resume, 900);
  }
  window.__screenmateAct.onInteraction(({ field, type }) => {
    if (field && (type === 'input' || type === 'change')) {
      const change = S.changes.find(change => change.step === S.step && change.fieldId === field.id && change.label === field.label);
      if (change) {
        change.after = window.__screenmateScan.currentValue(field.el);
        change.edited = true;
        change.fromPreference = false;
        change.verified = change.after ? window.__screenmateAct.verifyWrite(field, change.after).ok : !field.required;
      }
    }
    adaptToPage();
  });

  // SPA application dialogs can open long after page load. Debounce scans and
  // ignore mutations from our own panel so detection does not feed itself.
  let detectionTimer = null;
  let lastDetectedSignature = window.__screenmateScan.pageSignature();
  const detectionObserver = new MutationObserver((mutations) => {
    if (detectionTimer || !mutations.some((m) =>
      !m.target.closest?.('#screenmate-root') &&
      !m.target.closest?.('#screenmate-page-style'))) return;
    detectionTimer = setTimeout(() => {
      detectionTimer = null;
      publishChangedContext();
      const signature = window.__screenmateScan.pageSignature();
      const changed = signature !== lastDetectedSignature;
      lastDetectedSignature = signature;
      if (S.panel) {
        if (S.autoResume && changed && S.observedSig !== signature && S.status !== 'advancing') adaptToPage();
        else if (!S.running) {
          const before = S.fields.map(field => field.value).join('|');
          refreshValues();
          if (before !== S.fields.map(field => field.value).join('|')) paint();
        }
      } else autoMount();
    }, 500);
  });
  detectionObserver.observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, characterData: true,
    attributeFilter: ['hidden', 'style', 'class', 'aria-hidden', 'aria-label', 'aria-labelledby', 'aria-required', 'disabled', 'required'],
  });
  autoMount();
  setTimeout(autoMount, 1500);
  setTimeout(autoMount, 4000);
})();
