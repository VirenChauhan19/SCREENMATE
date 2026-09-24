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
  const STEP_DELAY = 120;
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

  async function queueApproval(field, reason) {
    if (S.resolvedSensitive.has(field.id)) return;
    if (S.approvalQueue.some((a) => a.fieldId === field.id)) return;

    // An upload is yours to attach: pause and offer the page's own picker.
    // Nothing is ever uploaded for you, and there is nothing to type.
    if (field.type === "file") {
      S.approvalQueue.push({
        fieldId: field.id,
        label: field.label,
        reason:
          "Attach it yourself: SCREENMATE opens this page's own file picker and never uploads anything for you.",
        options: null,
        topic: null,
        free: false,
        kind: "file",
      });
      return;
    }

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
      // An essay that merely mentions a topic word ("a race condition you
      // debugged") must not be remembered as your answer for that topic.
      topic: field.type === "textarea" ? null : field.topic || null,
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
      const landed = res.chosen || hit.value;
      // Wait out the widget before re-reading: a dropdown commits its choice
      // a beat after the click.
      await sleep(60);
      const check = window.__screenmateAct.verifyWrite(field, landed);
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
      handled += 1;
      await sleep(60);
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

    // A question the agent should not answer for you, most often one asking
    // about experience your profile does not describe. Say so once.
    if (action.tool === "flagIssue") {
      if (!S.noted.has(`flag:${field.id}`)) {
        S.noted.add(`flag:${field.id}`);
        log("warn", `${field.label} needs you`, action.args?.message || "Left for you to answer.");
      }
      return;
    }

    if (action.tool === "requestUserApproval") {
      // Settled earlier in this run: the model asking again is not news.
      if (S.resolvedSensitive.has(field.id)) return;
      await queueApproval(field, action.args.reason);
      log("lock", `${field.label} requires user input`, field.sensitiveReason);
      markStep("approval", "active");
      return;
    }

    // Client-side backstop. The server already rewrites these; the tool layer
    // refuses independently — the same three-layer guarantee as the web app.
    if (field.sensitive) {
      if (!S.resolvedSensitive.has(field.id)) {
        log("lock", `Blocked: ${field.label} is user-only`, "Requesting your decision.");
      }
      await queueApproval(field);
      return;
    }

    const value = (action.args?.value || "").trim();
    if (!value) return;

    // A question the agent already said it cannot answer honestly stays
    // yours: a later pass does not get to change its mind and write one.
    if (S.noted.has(`flag:${field.id}`)) return;

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
    await sleep(80);
    if (stale(gen)) return;

    let check = window.__screenmateAct.verifyWrite(field, landed);
    if (!check.ok) {
      log("warn", "Verification failed — retrying once", check.summary, true);
      const retry = await window.__screenmateAct.applyWrite(field, value);
      landed = retry.chosen || value;
      await sleep(150);
      check = window.__screenmateAct.verifyWrite(field, landed);
    }

    field.value = check.actual;
    if (!check.ok) S.failedWrites.add(attempt);

    // A second pass that rewrites the same field updates its entry, keeping
    // the original value so a revert still restores what the page first held.
    const earlier = S.changes.find((c) => c.fieldId === field.id);
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
    const res = await api("agent", payload("act"));
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
    for (const action of plan.actions) {
      await sleep(STEP_DELAY);
      if (stale(gen)) return "stale";
      if (action.tool === "researchCompany") {
        await runResearch();
        continue;
      }
      // The page loop validates every step itself once the pass ends.
      if (action.tool === "validateApplication") continue;
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
    const yours = S.fields.filter((f) => isOpen(f) && f.sensitive);
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
    if (S.approvalQueue.length) {
      setStatus("waiting");
      return "waiting";
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
        S.passes = 0;
        await sleep(STEP_DELAY);
        if (stale(gen)) return "stale";

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
          if (!res.ok) {
            failAgent(res);
            return "error";
          }
          if (stale(gen)) return "stale";
          plan = res.data;
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
      await sleep(60);
      const check = res.ok
        ? window.__screenmateAct.verifyWrite(field, res.chosen || value)
        : null;
      if (check?.ok) {
        window.__screenmateAct.highlight(field.el);
        field.value = check.actual;
      } else {
        log(
          "warn",
          `Could not set your answer on ${field.label}`,
          `${res.ok ? check.summary : res.reason} — set it on the page yourself.`,
        );
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

  /** Picks the run back up once the last pending question is settled. */
  function resumeAfterApproval() {
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

  /**
   * Opens the page's own file picker for an upload question. The file is
   * chosen by you and handed to the page by the browser; the extension never
   * reads or sends it. Must stay synchronous: the picker only opens inside
   * the click that asked for it.
   */
  function pickFile() {
    const req = S.approvalQueue[0];
    const field = req && S.fields.find((f) => f.id === req.fieldId);
    const input = field?.el;
    if (!input?.isConnected) return;
    if (S.filePick) input.removeEventListener("change", S.filePick);
    S.filePick = () => {
      const file = input.files?.[0];
      if (!file) return; // picker cancelled: the question stays open
      input.removeEventListener("change", S.filePick);
      S.filePick = null;
      if (S.approvalQueue[0]?.fieldId !== req.fieldId) return;
      S.approvalQueue.shift();
      S.resolvedSensitive.add(req.fieldId);
      S.stats.userDecisions += 1;
      field.value = `${input.files.length} file selected`;
      window.__screenmateAct.highlight(
        input.closest("li, [class*=question], [class*=field]") || input,
      );
      log("success", `${req.label} attached`, `"${file.name}", chosen by you.`);
      resumeAfterApproval();
    };
    input.addEventListener("change", S.filePick);
    input.click();
  }

  /** Leaves an optional sensitive question blank and moves on. */
  function skipApproval() {
    const req = S.approvalQueue.shift();
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
    const landed = res.chosen || text;
    const check = window.__screenmateAct.verifyWrite(field, landed);
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
      if (!stale(gen)) {
        S.running = false;
        setStatus(previous === "idle" ? "reviewing" : previous);
      }
    }
  }

  /** Puts one field back to whatever it held before the agent touched it. */
  async function revertOne(fieldId) {
    const change = S.changes.find((c) => c.fieldId === fieldId);
    const field = S.fields.find((f) => f.id === fieldId);
    if (!change || !field) return;

    const res = await window.__screenmateAct.applyWrite(field, change.before || "");
    if (!res.ok) {
      // Keep it listed: it is still on the page.
      log("warn", `Could not revert ${change.label}`, res.reason || "Change it back on the page.");
      return;
    }
    field.value = change.before || "";
    S.changes = S.changes.filter((c) => c.fieldId !== fieldId);
    S.resolvedSensitive.add(fieldId);
    log("warn", `${change.label} reverted`, "Put back to what it was.");
    S.report = validate();
    paint();
  }

  async function revertAll() {
    const stuck = [];
    for (const c of S.changes) {
      const field = S.fields.find((f) => f.id === c.fieldId);
      if (field) {
        const res = await window.__screenmateAct.applyWrite(field, c.before || "");
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
      lastObservationLog: null,
      submitHandoff: null,
      needsPrefs: false,
      resolvedSensitive: new Set(),
      failedWrites: new Set(),
      noted: new Set(),
      addressed: new Set(),
      passes: 0,
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
    // This page is an application: wake the backend now, while the person is
    // still reading, so the first Run does not wait on a cold start.
    chrome.runtime.sendMessage({ type: "screenmate:warm" }, () => void chrome.runtime.lastError);
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
        onPickFile: () => pickFile(),
        onSetPref: (topic, value) => void setPref(topic, value),
        onPrefsDone: async (freeValues = {}) => {
          for (const [topic, value] of Object.entries(freeValues)) {
            if (value) S.prefs = await window.__screenmatePrefs.setOne(topic, value);
          }
          S.prefs = await window.__screenmatePrefs.load();
          S.needsPrefs = false;
          // Edited after a run: save them, do not start the agent over.
          if (S.status === "idle" || S.status === "error") return void run();
          log("prefs", "Standing answers updated", "They apply from the next run on.");
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
          void mount({ collapsed: true });
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

  function autoMount() {
    try {
      if (S.panel) return;
      const fields = window.__screenmateScan.scanFields();
      if (!looksLikeApplication()) return;
      claimFrame(fields.length);
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
      const mine = isTop ? !childOwnsPanel : looksLikeApplication();
      if (S.panel || mine) void mount();
    } catch {
      /* ignore */
    }
  });

  window.__screenmateMount = mount;

  // Forms often render after load; give SPAs a couple of chances.
  autoMount();
  setTimeout(autoMount, 1500);
  setTimeout(autoMount, 4000);
})();
