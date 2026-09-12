"use client";

import { useCallback, useRef, useState } from "react";
import {
  DEFAULT_ROLE_ID,
  buildReport,
  createInitialState,
  hasValue,
  roleById,
} from "@/lib/application";
import { userProfile } from "@/lib/profile";
import {
  acceptField,
  executeAction,
  revertField,
  setFieldByUser,
  verifyAction,
} from "@/lib/tools";
import type {
  ActivityEntry,
  ActivityKind,
  AgentAction,
  AgentActionPlan,
  AgentPlan,
  AgentStatus,
  ApplicationState,
  ChangeRecord,
  PlanStep,
  PlanStepKind,
  ResearchContext,
  RunStats,
  ValidationReport,
} from "@/lib/types";

export interface ApprovalRequest {
  fieldId: string;
  reason: string;
}

export interface ContextAlert {
  fieldId: string;
  label: string;
  kind: "removed" | "edited";
  previous: string;
}

const MAX_PASSES = 3;
const STEP_DELAY = 460;
const VERIFY_DELAY = 240;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let seq = 0;
const nextId = () => `a${++seq}`;

const EMPTY_STATS: RunStats = {
  safeFields: 0,
  researchedResponses: 0,
  reviewedSuggestions: 0,
  userDecisions: 0,
  verifiedActions: 0,
  sourcesUsed: 0,
};

export function useScreenmate() {
  const [state, setState] = useState<ApplicationState>(() =>
    createInitialState(DEFAULT_ROLE_ID),
  );
  const [research, setResearch] = useState<ResearchContext | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [goal, setGoal] = useState<string | null>(null);
  const [steps, setSteps] = useState<PlanStep[]>([]);
  const [changes, setChanges] = useState<ChangeRecord[]>([]);
  const [approvalQueue, setApprovalQueue] = useState<ApprovalRequest[]>([]);
  const [contextAlert, setContextAlert] = useState<ContextAlert | null>(null);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [stats, setStats] = useState<RunStats>(EMPTY_STATS);
  const [banner, setBanner] = useState<string | null>(null);
  const [lastWrite, setLastWrite] = useState<{ fieldId: string; at: number } | null>(
    null,
  );

  // Refs let the async loop read current values without re-subscribing.
  const stateRef = useRef(state);
  stateRef.current = state;
  const researchRef = useRef(research);
  researchRef.current = research;
  const statusRef = useRef(status);
  statusRef.current = status;
  const changesRef = useRef<ChangeRecord[]>([]);
  const statsRef = useRef<RunStats>(EMPTY_STATS);
  const queueRef = useRef<ApprovalRequest[]>([]);
  const runningRef = useRef(false);
  const researchingRef = useRef(false);
  const historyRef = useRef<string[]>([]);
  const passRef = useRef(0);
  /** Bumped by reset/role change so an in-flight loop can detect it is orphaned. */
  const genRef = useRef(0);

  /* ---------------- Primitives ---------------- */

  const log = useCallback(
    (kind: ActivityKind, message: string, detail?: string, nested = false) => {
      setActivity((prev) => [
        ...prev,
        { id: nextId(), kind, message, detail, at: Date.now(), nested },
      ]);
    },
    [],
  );

  const commit = useCallback((next: ApplicationState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  /** True once a reset (or role switch) has superseded the run that captured `gen`. */
  const stale = useCallback((gen: number) => genRef.current !== gen, []);

  const bumpStats = useCallback((patch: Partial<RunStats>) => {
    const next = { ...statsRef.current };
    for (const [k, v] of Object.entries(patch)) {
      next[k as keyof RunStats] += v as number;
    }
    statsRef.current = next;
    setStats(next);
  }, []);

  /** Advances the first step of a given kind that has not finished yet. */
  const markStep = useCallback(
    (kind: PlanStepKind, next: PlanStep["status"]) => {
      setSteps((prev) => {
        const idx = prev.findIndex(
          (s) => s.kind === kind && s.status !== "done" && s.status !== "skipped",
        );
        if (idx === -1) return prev;
        const copy = [...prev];
        copy[idx] = { ...copy[idx], status: next };
        return copy;
      });
    },
    [],
  );

  const recordChange = useCallback((change: ChangeRecord) => {
    const existing = changesRef.current.findIndex(
      (c) => c.fieldId === change.fieldId,
    );
    const next = [...changesRef.current];
    // Keep the original "before" so the review diff stays truthful across retries.
    if (existing === -1) next.push(change);
    else next[existing] = { ...change, before: next[existing].before };
    changesRef.current = next;
    setChanges(next);
  }, []);

  const markChangeVerified = useCallback((fieldId: string, verified: boolean) => {
    const next = changesRef.current.map((c) =>
      c.fieldId === fieldId ? { ...c, verified } : c,
    );
    changesRef.current = next;
    setChanges(next);
  }, []);

  /* ---------------- Agent calls ---------------- */

  const agentPayload = useCallback(
    (phase: "plan" | "act" | "regenerate", extra: Record<string, unknown> = {}) => {
      const current = stateRef.current;
      const r = researchRef.current;
      return {
        phase,
        applicationState: {
          jobTitle: current.jobTitle,
          company: current.company,
          jobDescription: current.jobDescription,
          fields: current.fields.map((f) => ({
            id: f.id,
            label: f.label,
            type: f.type,
            section: f.section,
            value: f.value,
            required: f.required,
            sensitive: f.sensitive,
            level: f.level,
            options: f.options,
          })),
          completedFields: current.completedFields,
          totalFields: current.totalFields,
          validationErrors: current.validationErrors,
        },
        profile: userProfile,
        research: r
          ? {
              companySummary: r.companySummary,
              technicalFocus: r.technicalFocus,
              relevantContext: r.relevantContext,
              sourceCount: r.sources.length,
            }
          : null,
        recentActions: historyRef.current.slice(-20),
        ...extra,
      };
    },
    [],
  );

  const failAgent = useCallback(
    (reason: string) => {
      log("warn", "Agent temporarily unavailable", reason);
      setBanner("Agent temporarily unavailable. The form remains fully editable.");
      setStatus("error");
    },
    [log],
  );

  /* ---------------- Research ---------------- */

  const runResearch = useCallback(async (): Promise<ResearchContext | null> => {
    if (researchingRef.current) return researchRef.current;
    // Already have research for this exact role — do not spend the call again.
    const existing = researchRef.current;
    if (existing && existing.roleId === stateRef.current.roleId) {
      log("think", "Research reused", "Context for this role is already loaded.");
      return existing;
    }

    researchingRef.current = true;
    setStatus("researching");
    markStep("research", "active");
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: stateRef.current.company,
          role: stateRef.current.jobTitle,
          roleId: stateRef.current.roleId,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as ResearchContext;
      researchRef.current = data;
      setResearch(data);
      bumpStats({ sourcesUsed: data.sources.length });
      log(
        "success",
        "Company context retrieved",
        `${data.sources.length} source${data.sources.length === 1 ? "" : "s"}${
          data.technicalFocus.length
            ? ` · ${data.technicalFocus.slice(0, 3).join(", ")}`
            : ""
        }`,
      );
      markStep("research", "done");
      return data;
    } catch {
      log(
        "warn",
        "External research unavailable",
        "Continuing with the job description only.",
      );
      markStep("research", "skipped");
      return null;
    } finally {
      researchingRef.current = false;
    }
  }, [bumpStats, log, markStep]);

  /* ---------------- Execute + verify ---------------- */

  /**
   * Runs one action, then re-reads application state to confirm the environment
   * actually changed. Retries once for idempotent writes before giving up.
   */
  const executeVerified = useCallback(
    async (action: AgentAction, gen: number): Promise<void> => {
      if (stale(gen)) return;
      const attempt = () => executeAction(stateRef.current, action);
      let result = attempt();

      if (result.approvalRequest) {
        const { fieldId } = result.approvalRequest;
        const field = stateRef.current.fields.find((f) => f.id === fieldId);
        if (
          field &&
          !hasValue(field) &&
          !queueRef.current.some((p) => p.fieldId === fieldId)
        ) {
          queueRef.current = [...queueRef.current, result.approvalRequest];
        }
      }

      if (!result.ok) {
        log(result.approvalRequest ? "lock" : "warn", result.message, result.detail);
        if (result.approvalRequest) markStep("approval", "active");
        return;
      }

      commit(result.state);
      historyRef.current.push(`${action.tool} → ${result.message}`);
      log(
        action.tool === "requestUserApproval" ? "lock" : toKind(action.tool),
        result.message,
        result.detail,
      );

      if (action.tool === "requestUserApproval") {
        markStep("approval", "active");
        return;
      }
      if (result.touchedFieldId) {
        setLastWrite({ fieldId: result.touchedFieldId, at: Date.now() });
      }
      if (!result.change) return;

      recordChange(result.change);
      if (result.change.level === "review") {
        bumpStats({ reviewedSuggestions: 1 });
        if (result.change.regenerable && researchRef.current) {
          bumpStats({ researchedResponses: 1 });
        }
      } else {
        bumpStats({ safeFields: 1 });
      }

      /* --- verify --- */
      setStatus("verifying");
      await sleep(VERIFY_DELAY);
      if (stale(gen)) return;
      let check = verifyAction(
        stateRef.current,
        result.change.fieldId,
        result.change.after,
      );

      if (!check.ok && action.tool === "fillField") {
        // Writes here are idempotent, so a single retry is safe.
        log("warn", "Verification failed — retrying once", check.summary, true);
        const retry = attempt();
        if (retry.ok) {
          commit(retry.state);
          await sleep(VERIFY_DELAY);
          check = verifyAction(
            stateRef.current,
            result.change.fieldId,
            result.change.after,
          );
        }
      }

      markChangeVerified(result.change.fieldId, check.ok);
      if (check.ok) bumpStats({ verifiedActions: 1 });
      log(
        check.ok ? "verify" : "warn",
        check.ok
          ? "Field update confirmed"
          : `Verification failed — ${check.summary}`,
        check.checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.label}`).join("  ·  "),
        true,
      );
      setStatus("acting");
    },
    [bumpStats, commit, log, markChangeVerified, markStep, recordChange, stale],
  );

  /* ---------------- One action pass ---------------- */

  const runPass = useCallback(
    async (gen: number): Promise<"done" | "waiting" | "error" | "stale"> => {
    setStatus("planning");

    let plan: AgentActionPlan;
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(agentPayload("act")),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { reason?: string };
        failAgent(b.reason ?? `HTTP ${res.status}`);
        return "error";
      }
      plan = (await res.json()) as AgentActionPlan;
    } catch {
      failAgent("Could not reach the agent service.");
      return "error";
    }
    if (stale(gen)) return "stale";

    log("think", "Decision", plan.decisionSummary);
    setStatus("acting");
    markStep("fill", "active");

    for (const action of plan.actions) {
      await sleep(STEP_DELAY);
      if (stale(gen)) return "stale";
      if (action.tool === "researchCompany") {
        await runResearch();
        continue;
      }
      const isNarrative = action.args?.fieldId === "motivation";
      if (isNarrative) markStep("generate", "active");
      await executeVerified(action, gen);
      if (isNarrative) markStep("generate", "done");
    }

    markStep("fill", "done");

    if (queueRef.current.length > 0) {
      setApprovalQueue([...queueRef.current]);
      setStatus("waiting");
      return "waiting";
    }
    return "done";
    },
    [agentPayload, executeVerified, failAgent, log, markStep, runResearch, stale],
  );

  /* ---------------- Finalize: validate, then review ---------------- */

  const finalize = useCallback(async (gen: number) => {
    setStatus("verifying");
    markStep("validate", "active");
    await sleep(STEP_DELAY);
    if (stale(gen)) return;

    const result = executeAction(stateRef.current, {
      tool: "validateApplication",
      args: {},
    });
    commit(result.state);

    const nextReport = buildReport(stateRef.current.fields);
    setReport(nextReport);
    log(
      nextReport.blockers.length === 0 ? "success" : "warn",
      "Application check complete",
      `${nextReport.blockers.length} blocker${
        nextReport.blockers.length === 1 ? "" : "s"
      } · ${nextReport.warnings.length} warning${
        nextReport.warnings.length === 1 ? "" : "s"
      }`,
    );
    markStep("validate", "done");

    const unreviewed = changesRef.current.some((c) => {
      const f = stateRef.current.fields.find((x) => x.id === c.fieldId);
      return f && !f.reviewed;
    });

    if (changesRef.current.length > 0 && unreviewed) {
      markStep("review", "active");
      setStatus("reviewing");
      log(
        "observe",
        "Review requested",
        `${changesRef.current.length} change${
          changesRef.current.length === 1 ? "" : "s"
        } ready for your approval.`,
      );
      return;
    }

    markStep("review", "done");
    setStatus("complete");
  }, [commit, log, markStep, stale]);

  /* ---------------- Public: run ---------------- */

  const run = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    const gen = genRef.current;
    setBanner(null);
    setContextAlert(null);

    try {
      /* --- observe --- */
      setStatus("observing");
      const missing = stateRef.current.fields.filter((f) => !hasValue(f));
      log(
        "observe",
        "Application analyzed",
        missing.length === 0
          ? "All fields already hold a value."
          : `${missing.length} open field${missing.length === 1 ? "" : "s"}: ${missing
              .map((f) => f.label.replace(/\?$/, ""))
              .slice(0, 4)
              .join(", ")}${missing.length > 4 ? "…" : ""}`,
      );
      await sleep(STEP_DELAY);
      if (stale(gen)) return;

      /* --- plan --- */
      setStatus("planning");
      let plan: AgentPlan;
      try {
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(agentPayload("plan")),
        });
        if (!res.ok) {
          const b = (await res.json().catch(() => ({}))) as { reason?: string };
          failAgent(b.reason ?? `HTTP ${res.status}`);
          return;
        }
        plan = (await res.json()) as AgentPlan;
      } catch {
        failAgent("Could not reach the agent service.");
        return;
      }
      if (stale(gen)) return;

      setGoal(plan.goal);
      setSteps(plan.steps.map((s) => ({ ...s, status: "pending" as const })));
      log("observe", "Observation", plan.observation);
      markStep("observe", "done");
      await sleep(STEP_DELAY);

      /* --- research decision: a real branch, not a formality --- */
      if (plan.researchNeeded) {
        log("research", "Research required", plan.researchRationale);
        if (
          researchRef.current &&
          researchRef.current.roleId !== stateRef.current.roleId
        ) {
          researchRef.current = null;
        }
        await runResearch();
      } else {
        log("think", "Context check", plan.researchRationale);
        markStep("research", "skipped");
      }
      await sleep(STEP_DELAY);
      if (stale(gen)) return;

      /* --- act --- */
      passRef.current = 0;
      let outcome = await runPass(gen);
      while (outcome === "done" && passRef.current < MAX_PASSES) {
        passRef.current += 1;
        const stillOpen = stateRef.current.fields.filter(
          (f) => f.required && !hasValue(f) && !f.sensitive,
        );
        if (stillOpen.length === 0) break;
        outcome = await runPass(gen);
      }

      if (outcome === "done") await finalize(gen);
    } finally {
      // An orphaned loop must not clear the flag held by the run that replaced it.
      if (!stale(gen)) runningRef.current = false;
    }
  }, [agentPayload, failAgent, finalize, log, markStep, runPass, runResearch, stale]);

  /* ---------------- Public: approvals ---------------- */

  const resolveApproval = useCallback(
    (fieldId: string, value: string) => {
      const field = stateRef.current.fields.find((f) => f.id === fieldId);
      commit(setFieldByUser(stateRef.current, fieldId, value));
      setLastWrite({ fieldId, at: Date.now() });
      historyRef.current.push(`user answered ${fieldId} = ${value}`);
      bumpStats({ userDecisions: 1 });
      log(
        "success",
        `${field?.label.replace(/\?$/, "") ?? fieldId} answered by user`,
        `"${value}" — recorded from your decision, not the agent's.`,
      );

      const rest = queueRef.current.filter((q) => q.fieldId !== fieldId);
      queueRef.current = rest;
      setApprovalQueue(rest);
      if (rest.length > 0) return;

      markStep("approval", "done");
      if (runningRef.current) return;
      runningRef.current = true;
      const gen = genRef.current;
      setStatus("acting");
      void (async () => {
        try {
          await sleep(STEP_DELAY);
          if (stale(gen)) return;
          const stillOpen = stateRef.current.fields.filter(
            (f) => f.required && !hasValue(f) && !f.sensitive,
          );
          const outcome = stillOpen.length > 0 ? await runPass(gen) : "done";
          if (outcome === "done") await finalize(gen);
        } finally {
          if (!stale(gen)) runningRef.current = false;
        }
      })();
    },
    [bumpStats, commit, finalize, log, markStep, runPass, stale],
  );

  /* ---------------- Public: review ---------------- */

  const acceptChange = useCallback(
    (fieldId: string) => {
      commit(acceptField(stateRef.current, fieldId));
      const c = changesRef.current.find((x) => x.fieldId === fieldId);
      log("success", `${c?.label.replace(/\?$/, "") ?? fieldId} accepted`);
    },
    [commit, log],
  );

  const acceptAllChanges = useCallback(() => {
    let next = stateRef.current;
    for (const c of changesRef.current) next = acceptField(next, c.fieldId);
    commit(next);
    log(
      "success",
      "All changes accepted",
      `${changesRef.current.length} field${
        changesRef.current.length === 1 ? "" : "s"
      } confirmed by you.`,
    );
    setReport(buildReport(next.fields));
    markStep("review", "done");
    setStatus("complete");
  }, [commit, log, markStep, stale]);

  const rejectChange = useCallback(
    (fieldId: string) => {
      const c = changesRef.current.find((x) => x.fieldId === fieldId);
      if (!c) return;
      commit(revertField(stateRef.current, fieldId, c.before));
      changesRef.current = changesRef.current.filter((x) => x.fieldId !== fieldId);
      setChanges(changesRef.current);
      log("warn", `${c.label.replace(/\?$/, "")} reverted`, "Agent value discarded.");
    },
    [commit, log],
  );

  const editChange = useCallback(
    (fieldId: string, value: string) => {
      commit(setFieldByUser(stateRef.current, fieldId, value));
      const c = changesRef.current.find((x) => x.fieldId === fieldId);
      if (c) {
        changesRef.current = changesRef.current.map((x) =>
          x.fieldId === fieldId
            ? { ...x, after: value, confidence: "high" as const }
            : x,
        );
        setChanges(changesRef.current);
      }
      log("write", `${c?.label.replace(/\?$/, "") ?? fieldId} edited by user`);
    },
    [commit, log],
  );

  const regenerate = useCallback(
    async (fieldId: string) => {
      if (runningRef.current) return;
      runningRef.current = true;
      const gen = genRef.current;
      setStatus("acting");
      try {
        log("think", "Regenerating response", "Producing a different angle.");
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            agentPayload("regenerate", { targetFieldId: fieldId }),
          ),
        });
        if (!res.ok) {
          log("warn", "Regeneration unavailable", "Keeping the existing answer.");
          return;
        }
        const data = (await res.json()) as { value: string; note?: string };
        await executeVerified(
          { tool: "fillField", args: { fieldId, value: data.value } },
          gen,
        );
        if (data.note) log("think", "Revision note", data.note, true);
      } catch {
        log("warn", "Regeneration unavailable", "Keeping the existing answer.");
      } finally {
        if (!stale(gen)) {
          runningRef.current = false;
          setStatus("reviewing");
        }
      }
    },
    [agentPayload, executeVerified, log, stale],
  );

  const completeReview = useCallback(() => {
    setReport(buildReport(stateRef.current.fields));
    markStep("review", "done");
    setStatus("complete");
  }, [markStep]);

  /* ---------------- Public: environment changes ---------------- */

  const updateField = useCallback(
    (fieldId: string, value: string) => {
      const before = stateRef.current.fields.find((f) => f.id === fieldId);
      const wasAgentFilled = Boolean(before?.filledByAgent);
      const previous = before?.value ?? "";

      commit(setFieldByUser(stateRef.current, fieldId, value));

      // The environment changed under the agent — say so rather than silently
      // re-filling. This is what makes SCREENMATE reactive rather than scripted.
      if (wasAgentFilled && previous && previous !== value) {
        const removed = value.trim().length === 0;
        setContextAlert({
          fieldId,
          label: before?.label ?? fieldId,
          kind: removed ? "removed" : "edited",
          previous,
        });
        log(
          "context",
          "Context changed",
          `${before?.label.replace(/\?$/, "")} was ${
            removed ? "removed" : "edited"
          } after the agent filled it.`,
        );
        if (statusRef.current === "complete") setStatus("reviewing");
      }
    },
    [commit, log],
  );

  const restoreField = useCallback(() => {
    if (!contextAlert) return;
    const { fieldId, previous, label } = contextAlert;
    const result = executeAction(stateRef.current, {
      tool: "fillField",
      args: { fieldId, value: previous },
    });
    if (result.ok) {
      commit(result.state);
      setLastWrite({ fieldId, at: Date.now() });
      log("write", `${label.replace(/\?$/, "")} restored`, previous.slice(0, 80));
    } else {
      log("warn", result.message, result.detail);
    }
    setContextAlert(null);
  }, [commit, contextAlert, log]);

  const dismissContextAlert = useCallback(() => {
    if (contextAlert) {
      log(
        "observe",
        "Waiting for user instruction",
        "Agent left the change in place.",
      );
    }
    setContextAlert(null);
  }, [contextAlert, log]);

  /** Switching roles invalidates any research gathered for the previous one. */
  const changeRole = useCallback(
    (roleId: string) => {
      if (roleId === stateRef.current.roleId) return;
      genRef.current += 1;
      runningRef.current = false;
      const role = roleById(roleId);
      commit({
        ...stateRef.current,
        roleId: role.id,
        jobTitle: role.jobTitle,
        company: role.company,
        jobDescription: role.jobDescription,
      });
      log("context", "Context updated", `Role changed to ${role.jobTitle}.`);

      if (researchRef.current) {
        researchRef.current = null;
        setResearch(null);
        log(
          "research",
          "Previous company context invalidated",
          "Research was gathered for a different opening.",
        );
      }

      const motivation = stateRef.current.fields.find((f) => f.id === "motivation");
      if (motivation?.filledByAgent && hasValue(motivation)) {
        log(
          "warn",
          "Tailored response may be stale",
          "It was written against the previous role description.",
        );
      }
      setStatus("idle");
      setSteps([]);
      setGoal(null);
      setReport(null);
    },
    [commit, log],
  );

  /* ---------------- Public: demo controls ---------------- */

  const reset = useCallback((roleId?: string) => {
    // Orphan any loop still in flight before wiping state out from under it.
    genRef.current += 1;
    runningRef.current = false;
    researchingRef.current = false;
    historyRef.current = [];
    passRef.current = 0;
    researchRef.current = null;
    changesRef.current = [];
    queueRef.current = [];
    statsRef.current = EMPTY_STATS;

    const fresh = createInitialState(roleId ?? stateRef.current.roleId);
    stateRef.current = fresh;
    setState(fresh);
    setResearch(null);
    setActivity([]);
    setStatus("idle");
    setGoal(null);
    setSteps([]);
    setChanges([]);
    setApprovalQueue([]);
    setContextAlert(null);
    setReport(null);
    setStats(EMPTY_STATS);
    setBanner(null);
    setLastWrite(null);
  }, []);

  /**
   * Demo mode guarantees a predictable STARTING state only. The agent still
   * reasons, researches, calls tools, and stops for approval for real.
   */
  const startDemo = useCallback(() => {
    reset(DEFAULT_ROLE_ID);
    setTimeout(() => void run(), 280);
  }, [reset, run]);

  return {
    state,
    research,
    activity,
    status,
    goal,
    steps,
    changes,
    report,
    stats,
    approval: approvalQueue[0] ?? null,
    approvalCount: approvalQueue.length,
    contextAlert,
    banner,
    lastWrite,
    isRunning:
      status === "observing" ||
      status === "researching" ||
      status === "planning" ||
      status === "acting" ||
      status === "verifying",
    run,
    reset,
    startDemo,
    updateField,
    resolveApproval,
    acceptChange,
    acceptAllChanges,
    rejectChange,
    editChange,
    regenerate,
    completeReview,
    restoreField,
    dismissContextAlert,
    changeRole,
  };
}

function toKind(tool: string): ActivityKind {
  switch (tool) {
    case "fillField":
      return "write";
    case "selectOption":
      return "action";
    case "validateApplication":
      return "success";
    case "flagIssue":
      return "warn";
    default:
      return "action";
  }
}
