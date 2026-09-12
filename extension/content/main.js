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
    submitHandoff: null,
    prefs: {},
    needsPrefs: false,
    /** Sensitive fields already settled this run — prevents re-asking forever. */
    resolvedSensitive: new Set(),
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
  async function observe() {
    const scanned = window.__screenmateScan.scanFields();
    S.context = window.__screenmateScan.pageContext();

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
      })),
    });

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
    }));

    const c = counts();
    log(
      "observe",
      `Step ${S.step} analyzed${S.context.stepLabel ? ` · ${S.context.stepLabel}` : ""}`,
      `${c.total} fields · ${c.total - c.filled} open · ${c.sensitive} sensitive`,
    );
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

  async function runResearch() {
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
    if (S.resolvedSensitive.has(field.id)) return;
    if (S.approvalQueue.some((a) => a.fieldId === field.id)) return;

    let options = null;
    let free = true;
    if (field.type === "select") {
      // Never guess. Open the widget and read its real choices, so we cannot
      // offer "Yes/No" on a question whose answers are nothing of the kind.
      options = field.options?.length
        ? field.options
        : await window.__screenmateAct.readOptions(field);
      free = !options || options.length === 0;
      if (!free) field.options = options;
    }

    S.approvalQueue.push({
      fieldId: field.id,
      label: field.label,
      reason: field.sensitiveReason || reason || "",
      options: free ? null : options,
      topic: field.topic || null,
      free,
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
      // Any field the policy recognised as a standing-answer question, whether
      // or not it also tripped the sensitive list.
      if (!field.topic) continue;
      if ((field.value || "").trim()) continue;
      if (S.resolvedSensitive.has(field.id)) continue;

      // Resolve against the widget's real choices, not a guess.
      if (field.type === "select" && !field.options?.length) {
        const discovered = await window.__screenmateAct.readOptions(field);
        if (discovered.length) field.options = discovered;
      }
      const hit = window.__screenmatePrefs.resolve(field, S.prefs);
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
      window.__screenmateAct.highlight(field.el);
      const check = window.__screenmateAct.verifyWrite(field, hit.value);
      field.value = check.actual;
      S.resolvedSensitive.add(field.id);
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

  async function applyAction(action, gen) {
    const field = S.fields.find((f) => f.id === action.args?.fieldId);
    if (!field) {
      log("warn", `Unknown field "${action.args?.fieldId}" ignored`);
      return;
    }

    if (action.tool === "requestUserApproval") {
      await queueApproval(field, action.args.reason);
      log("lock", `${field.label} requires user input`, field.sensitiveReason);
      markStep("approval", "active");
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
    const written = await window.__screenmateAct.applyWrite(field, value);
    if (!written.ok) {
      log("warn", `Could not write ${field.label}`, written.reason);
      return;
    }
    window.__screenmateAct.highlight(field.el);
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
      await window.__screenmateAct.applyWrite(field, value);
      await sleep(240);
      check = window.__screenmateAct.verifyWrite(field, value);
    }

    field.value = check.actual;
    if (check.ok) S.stats.verifiedActions += 1;
    if (field.level === "review") S.stats.reviewedSuggestions += 1;
    else S.stats.safeFields += 1;

    S.changes.push({
      fieldId: field.id,
      label: field.label,
      before,
      after: value,
      verified: check.ok,
      level: field.level,
      step: S.step,
    });

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
    const res = await api("agent", payload("act"));
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
      if (action.tool === "researchCompany") {
        await runResearch();
        continue;
      }
      await applyAction(action, gen);
    }
    markStep("fill", "done");

    if (S.approvalQueue.length) {
      setStatus("waiting");
      return "waiting";
    }
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
      blockers: open.map((f) => ({
        fieldId: f.id,
        message: `${f.label} is required.`,
      })),
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
        await sleep(STEP_DELAY);
        if (stale(gen)) return "stale";

        // Plan per step: each page of a wizard asks for different things.
        setStatus("planning");
        const res = await api("agent", payload("plan"));
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
          await runResearch();
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

      let outcome = await runPass(gen);
      let extra = 0;
      while (outcome === "done" && extra < 1) {
        extra += 1;
        const open = S.fields.filter(
          (f) => f.required && !f.sensitive && !(f.value || "").trim(),
        );
        if (!open.length) break;
        outcome = await runPass(gen);
      }
      if (outcome !== "done") return outcome;

      recordPage();
      S.report = validate();
      markStep("validate", "done");

      /* --- advance, or stop --- */
      const next = window.__screenmateNav.findAdvanceControl();
      if (!next) {
        S.submitHandoff = window.__screenmateNav.findSubmitControl();
        break;
      }
      if (S.step >= MAX_STEPS) {
        log("warn", "Step limit reached", `Stopped after ${MAX_STEPS} steps.`);
        break;
      }

      setStatus("advancing");
      log("nav", `Advancing to step ${S.step + 1}`, `Clicking "${next.text}"`);
      const moved = await window.__screenmateNav.advance(next);
      if (!moved.ok) {
        log("warn", "Could not advance", moved.reason);
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

    if (S.changes.length) {
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
   * First run on a machine collects standing answers before touching anything.
   * Answering them once is what lets the agent walk a whole wizard without
   * interrupting you on every step.
   */
  async function startRun() {
    S.prefs = await window.__screenmatePrefs.load();
    if (!window.__screenmatePrefs.isComplete(S.prefs)) {
      S.needsPrefs = true;
      log(
        "prefs",
        "Set your standing answers first",
        "Answer these once and SCREENMATE applies them on every application.",
      );
      paint();
      return;
    }
    void run();
  }

  async function run() {
    if (S.running) return;
    S.running = true;
    const gen = S.gen;
    S.banner = null;
    S.observedSig = null;

    try {
      await pageLoop(gen);
    } finally {
      if (!stale(gen)) S.running = false;
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
    if (req.topic && remember) {
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
      if (!stale(gen)) S.running = false;
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
        if (!stale(gen)) S.running = false;
      }
    })();
  }

  async function revertAll() {
    for (const c of S.changes) {
      const field = S.fields.find((f) => f.id === c.fieldId);
      if (field) {
        await window.__screenmateAct.applyWrite(field, c.before || "");
        field.value = c.before || "";
      }
    }
    log(
      "warn",
      "Agent changes reverted on this step",
      "Earlier steps are left as they are — navigate back to change those.",
    );
    S.changes = S.changes.filter((c) => c.step !== S.step);
    S.report = validate();
    setStatus("complete");
  }

  function acceptAll() {
    log("success", "All changes accepted", `${S.changes.length} fields confirmed.`);
    S.report = validate();
    markStep("review", "done");
    setStatus("complete");
  }

  function reset() {
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
      submitHandoff: null,
      needsPrefs: false,
      resolvedSensitive: new Set(),
      stats: EMPTY_STATS(),
    });
    void observe().then(() => {
      S.observedSig = window.__screenmateScan.pageSignature();
      paint();
    });
  }

  /* ---------------- boot ---------------- */

  async function mount({ collapsed = false } = {}) {
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
          void run();
        },
        onEditPrefs: () => {
          S.needsPrefs = true;
          paint();
        },
        onAcceptAll: () => acceptAll(),
        onRevertAll: () => void revertAll(),
        onExpand: () => {
          // Classification costs a backend call, so defer it until the panel is
          // actually opened rather than firing on every page load.
          if (!S.fields.length || S.fields.__unclassified) {
            void observe().then(() => paint());
          }
        },
        onClose: () => {
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

  function autoMount() {
    try {
      if (S.panel || !looksLikeApplication()) return;
      void mount({ collapsed: true });
    } catch {
      /* never let detection break the host page */
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "screenmate:toggle" || msg?.type === "screenmate:open") {
      void mount();
    }
  });

  window.__screenmateMount = mount;

  // Forms often render after load; give SPAs a couple of chances.
  autoMount();
  setTimeout(autoMount, 1500);
  setTimeout(autoMount, 4000);
})();
