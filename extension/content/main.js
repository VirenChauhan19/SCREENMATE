/**
 * Orchestration: observe → classify → plan → research → act → verify →
 * approve → validate → review.
 *
 * Deliberately the same loop as the web app's useScreenmate. The only thing
 * that changed is where ApplicationState comes from and where tool writes land.
 */

(() => {
  if (window.__screenmateLoaded) return;
  window.__screenmateLoaded = true;

  const STEP_DELAY = 420;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    stats: {
      safeFields: 0,
      reviewedSuggestions: 0,
      userDecisions: 0,
      verifiedActions: 0,
      sourcesUsed: 0,
    },
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
      activity: S.activity.slice(-40),
      research: S.research,
      approval: S.approvalQueue[0] || null,
      changes: S.changes,
      report: S.report,
      stats: S.stats,
      banner: S.banner,
      counts: S.fields.length ? counts() : null,
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
   * Rescans the DOM and re-classifies through the backend.
   * Classification is the ONLY place levels come from — if it fails we fail
   * closed and refuse to touch anything.
   */
  async function observe() {
    const scanned = window.__screenmateScan.scanFields();
    S.context = window.__screenmateScan.pageContext();

    if (scanned.length === 0) {
      S.fields = [];
      log("warn", "No form fields found on this page", "Try a job application page.");
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

    // Re-attach live element handles; they never leave the content script.
    const byId = new Map(scanned.map((f) => [f.id, f]));
    delete S.fields.__unclassified;
    S.fields = res.data.fields.map((f) => ({
      ...f,
      el: byId.get(f.id)?.el,
      value: byId.get(f.id)?.value || "",
    }));

    const c = counts();
    log(
      "observe",
      "Page analyzed",
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
      `${res.data.sources.length} sources${res.data.technicalFocus?.length ? ` · ${res.data.technicalFocus.slice(0, 3).join(", ")}` : ""}`,
    );
    markStep("research", "done");
  }

  /* ---------------- act + verify ---------------- */

  async function applyAction(action, gen) {
    const field = S.fields.find((f) => f.id === action.args?.fieldId);
    if (!field) {
      log("warn", `Unknown field "${action.args?.fieldId}" ignored`);
      return;
    }

    if (action.tool === "requestUserApproval") {
      if (!S.approvalQueue.some((a) => a.fieldId === field.id)) {
        S.approvalQueue.push({
          fieldId: field.id,
          label: field.label,
          reason: field.sensitiveReason || action.args.reason || "",
          options: field.options,
        });
      }
      log("lock", `${field.label} requires user input`, field.sensitiveReason);
      markStep("approval", "active");
      return;
    }

    // Client-side backstop. The server already rewrites these, but the tool
    // layer refuses independently — same three-layer guarantee as the web app.
    if (field.sensitive) {
      log("lock", `Blocked: ${field.label} is user-only`, "Requesting your decision instead.");
      if (!S.approvalQueue.some((a) => a.fieldId === field.id)) {
        S.approvalQueue.push({
          fieldId: field.id,
          label: field.label,
          reason: field.sensitiveReason || "",
          options: field.options,
        });
      }
      return;
    }

    const value = (action.args?.value || "").trim();
    if (!value) return;

    const before = field.value || "";
    const written = window.__screenmateAct.applyWrite(field, value);
    if (!written.ok) {
      log("warn", `Could not write ${field.label}`, written.reason);
      return;
    }
    window.__screenmateAct.highlight(field.el);
    log("write", `${field.label} completed`, value.length > 90 ? `${value.slice(0, 89)}…` : value);

    setStatus("verifying");
    await sleep(200);
    if (stale(gen)) return;

    let check = window.__screenmateAct.verifyWrite(field, value);
    if (!check.ok && field.type !== "select") {
      log("warn", "Verification failed — retrying once", check.summary, true);
      window.__screenmateAct.applyWrite(field, value);
      await sleep(220);
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
        if (!S.research) await runResearch();
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

  /* ---------------- validate + review ---------------- */

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
          detail: open.length ? `${open.length} still empty` : undefined,
        },
        { id: "urls", label: "URLs valid", ok: badUrl.length === 0 },
        { id: "email", label: "Email format valid", ok: badEmail.length === 0 },
        {
          id: "sensitive",
          label: "No unresolved sensitive questions",
          ok: sensitiveOpen.length === 0,
          detail: sensitiveOpen.length ? `${sensitiveOpen.length} awaiting you` : undefined,
        },
        {
          id: "verified",
          label: "All writes verified against the page",
          ok: unverified.length === 0,
          detail: unverified.length ? `${unverified.length} unconfirmed` : undefined,
        },
      ],
      blockers: open.map((f) => ({ fieldId: f.id, message: `${f.label} is required.` })),
    };
  }

  async function finalize(gen) {
    setStatus("verifying");
    markStep("validate", "active");
    await sleep(STEP_DELAY);
    if (stale(gen)) return;

    S.report = validate();
    const blockers = S.report.blockers.length;
    log(
      blockers === 0 ? "success" : "warn",
      "Application check complete",
      `${blockers} blocker${blockers === 1 ? "" : "s"}`,
    );
    markStep("validate", "done");

    if (S.changes.length) {
      markStep("review", "active");
      setStatus("reviewing");
      log("observe", "Review requested", `${S.changes.length} changes written to this page.`);
      return;
    }
    setStatus("complete");
  }

  /* ---------------- run ---------------- */

  async function run() {
    if (S.running) return;
    S.running = true;
    const gen = S.gen;
    S.banner = null;

    try {
      setStatus("observing");
      if (!(await observe())) return;
      if (stale(gen)) return;
      await sleep(STEP_DELAY);

      setStatus("planning");
      const res = await api("agent", payload("plan"));
      if (!res.ok) return failAgent(res);
      if (stale(gen)) return;

      const plan = res.data;
      S.goal = plan.goal;
      S.steps = plan.steps.map((s) => ({ ...s, status: "pending" }));
      log("observe", "Observation", plan.observation);
      markStep("observe", "done");
      await sleep(STEP_DELAY);

      if (plan.researchNeeded) {
        log("research", "Research required", plan.researchRationale);
        await runResearch();
      } else {
        log("think", "Context check", plan.researchRationale);
        markStep("research", "skipped");
      }
      await sleep(STEP_DELAY);
      if (stale(gen)) return;

      let outcome = await runPass(gen);
      let passes = 0;
      while (outcome === "done" && passes < 2) {
        passes += 1;
        const open = S.fields.filter(
          (f) => f.required && !f.sensitive && !(f.value || "").trim(),
        );
        if (!open.length) break;
        outcome = await runPass(gen);
      }
      if (outcome === "done") await finalize(gen);
    } finally {
      if (!stale(gen)) S.running = false;
    }
  }

  /* ---------------- user actions ---------------- */

  async function answer(value) {
    const req = S.approvalQueue[0];
    if (!req) return;
    const field = S.fields.find((f) => f.id === req.fieldId);
    if (field) {
      const res = window.__screenmateAct.applyWrite(field, value);
      if (res.ok) {
        window.__screenmateAct.highlight(field.el);
        const check = window.__screenmateAct.verifyWrite(field, value);
        field.value = check.actual;
      } else {
        log("warn", `Could not write your answer to ${field.label}`, res.reason);
      }
    }
    S.stats.userDecisions += 1;
    S.approvalQueue.shift();
    log("success", `${req.label} answered by you`, `"${value}" — your decision, not the agent's.`);

    if (S.approvalQueue.length) return paint();
    markStep("approval", "done");

    if (S.running) return;
    S.running = true;
    const gen = S.gen;
    setStatus("acting");
    try {
      await sleep(STEP_DELAY);
      if (stale(gen)) return;
      const open = S.fields.filter(
        (f) => f.required && !f.sensitive && !(f.value || "").trim(),
      );
      const outcome = open.length ? await runPass(gen) : "done";
      if (outcome === "done") await finalize(gen);
    } finally {
      if (!stale(gen)) S.running = false;
    }
  }

  function revertAll() {
    for (const c of S.changes) {
      const field = S.fields.find((f) => f.id === c.fieldId);
      if (field) {
        window.__screenmateAct.applyWrite(field, c.before || "");
        field.value = c.before || "";
      }
    }
    log("warn", "All agent changes reverted", `${S.changes.length} fields restored.`);
    S.changes = [];
    S.report = validate();
    setStatus("complete");
  }

  function acceptAll() {
    log("success", "All changes accepted", `${S.changes.length} fields confirmed by you.`);
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
      stats: {
        safeFields: 0,
        reviewedSuggestions: 0,
        userDecisions: 0,
        verifiedActions: 0,
        sourcesUsed: 0,
      },
    });
    void observe().then(() => paint());
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

    S.panel = new window.__screenmatePanel(
      {
        onRun: () => void run(),
        onRescan: () => reset(),
        onAnswer: (v) => void answer(v),
        onAcceptAll: () => acceptAll(),
        onRevertAll: () => revertAll(),
        onExpand: () => {
          // Classification costs a backend call, so defer it until the panel
          // is actually opened rather than firing on every page load.
          if (!S.fields.length) void observe().then(() => paint());
        },
        onClose: () => {
          S.panel.remove();
          S.panel = null;
        },
      },
      { collapsed },
    );

    if (collapsed) {
      // Enough for the pill's "N open" badge without touching the network.
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
   * Deliberately conservative: a login box or a search field should not summon
   * an agent panel.
   */
  function looksLikeApplication() {
    const fields = window.__screenmateScan.scanFields();
    if (fields.length < 4) return false;
    const text = fields.map((f) => f.label.toLowerCase()).join(" ");
    const hasIdentity = /name|email/.test(text);
    const hasDepth = fields.length >= 6 || /resume|cover|why|experience/.test(text);
    return hasIdentity && hasDepth;
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
    if (msg?.type === "screenmate:toggle") void mount();
    if (msg?.type === "screenmate:open") void mount();
  });

  window.__screenmateMount = mount;

  // Forms often render after load; give SPAs a couple of chances.
  autoMount();
  setTimeout(autoMount, 1500);
  setTimeout(autoMount, 4000);
})();
