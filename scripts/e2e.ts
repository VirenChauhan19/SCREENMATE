/** Drives the real APIs the same way the hook does, then asserts the outcome. */
import { buildReport, createInitialState, hasValue } from "../src/lib/application";
import { userProfile } from "../src/lib/profile";
import {
  acceptField,
  executeAction,
  setFieldByUser,
  verifyAction,
} from "../src/lib/tools";
import type {
  AgentActionPlan,
  AgentPlan,
  ApplicationState,
  ChangeRecord,
  ResearchContext,
} from "../src/lib/types";

const BASE = "http://localhost:3000";
let state: ApplicationState = createInitialState();
let research: ResearchContext | null = null;
const changes: ChangeRecord[] = [];
const history: string[] = [];
let verified = 0;
let failures = 0;

const payload = (phase: string, extra: Record<string, unknown> = {}) => ({
  phase,
  applicationState: {
    jobTitle: state.jobTitle,
    company: state.company,
    jobDescription: state.jobDescription,
    fields: state.fields.map((f) => ({
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
    completedFields: state.completedFields,
    totalFields: state.totalFields,
    validationErrors: state.validationErrors,
  },
  profile: userProfile,
  research: research
    ? {
        companySummary: research.companySummary,
        technicalFocus: research.technicalFocus,
        relevantContext: research.relevantContext,
        sourceCount: research.sources.length,
      }
    : null,
  recentActions: history.slice(-20),
  ...extra,
});

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

async function runPass(label: string) {
  const plan = await post<AgentActionPlan>("/api/agent", payload("act"));
  console.log(`\n-- ${label}: ${plan.decisionSummary}`);
  const approvals: string[] = [];

  for (const action of plan.actions) {
    const result = executeAction(state, action);
    if (result.approvalRequest) approvals.push(result.approvalRequest.fieldId);

    if (!result.ok) {
      console.log(`   XX ${action.tool.padEnd(20)} ${result.message}`);
      continue;
    }
    state = result.state;
    history.push(`${action.tool} -> ${result.message}`);
    console.log(
      `   OK ${action.tool.padEnd(20)} ${result.message}` +
        (action.confidence ? `  [${action.confidence}]` : ""),
    );

    if (!result.change) continue;
    changes.push(result.change);
    const check = verifyAction(state, result.change.fieldId, result.change.after);
    if (check.ok) verified++;
    else failures++;
    console.log(
      `      VERIFY ${check.ok ? "confirmed" : "FAILED"} :: ${check.checks
        .map((c) => `${c.ok ? "+" : "-"}${c.label}`)
        .join(" ")}`,
    );
  }
  return approvals;
}

async function main() {
  console.log(`start: ${state.completedFields}/${state.totalFields}`);

  /* plan */
  const plan = await post<AgentPlan>("/api/agent", payload("plan"));
  console.log(`\nGOAL: ${plan.goal}`);
  console.log(`RESEARCH NEEDED: ${plan.researchNeeded}`);
  console.log("PLAN:");
  for (const s of plan.steps) console.log(`   [${s.kind}] ${s.label}`);

  /* research */
  if (plan.researchNeeded) {
    research = await post<ResearchContext>("/api/research", {
      company: state.company,
      role: state.jobTitle,
      roleId: state.roleId,
    });
    console.log(
      `\nRESEARCH: ${research.sources.length} sources, degraded=${Boolean(
        research.degraded,
      )}`,
    );
    for (const s of research.sources) {
      console.log(`   - ${s.relevance} :: ${s.title.slice(0, 58)}`);
    }
  }

  /* act */
  let approvals = await runPass("pass 1");
  console.log(`\nafter agent: ${state.completedFields}/${state.totalFields}`);
  console.log(`approvals pending: ${approvals.join(", ") || "none"}`);

  /* user answers */
  for (const id of approvals) state = setFieldByUser(state, id, "No");
  console.log(`after user: ${state.completedFields}/${state.totalFields}`);

  /* review */
  for (const c of changes) state = acceptField(state, c.fieldId);

  /* validate */
  const report = buildReport(state.fields);
  console.log("\nVALIDATION:");
  for (const c of report.checks) {
    console.log(`   ${c.ok ? "PASS" : "FAIL"}  ${c.label}${c.detail ? ` (${c.detail})` : ""}`);
  }
  console.log(`   blockers=${report.blockers.length} warnings=${report.warnings.length}`);

  console.log("\nPROVENANCE:");
  for (const f of state.fields) {
    console.log(
      `   ${f.id.padEnd(15)} ${(f.filledByAgent ? "agent" : "user ").padEnd(6)}` +
        `${(f.confidence ?? "-").padEnd(7)} ${String(f.value).slice(0, 42)}`,
    );
  }

  console.log(`\nverified=${verified} verifyFailures=${failures}`);
  const open = state.fields.filter((f) => f.required && !hasValue(f));
  console.log(`RESULT: ${open.length === 0 && report.blockers.length === 0 ? "PASS" : "FAIL"}`);
}

main().catch((e) => {
  console.error("E2E ERROR:", e.message);
  process.exit(1);
});
