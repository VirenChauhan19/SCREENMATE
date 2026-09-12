import { buildReport, deriveState, hasValue } from "./application";
import { confidenceFor } from "./policy";
import { userProfile } from "./profile";
import type {
  AgentAction,
  ApplicationField,
  ApplicationState,
  ChangeRecord,
  ToolName,
  UserProfile,
  VerifyCheck,
  VerifyResult,
} from "./types";

export const TOOL_NAMES: ToolName[] = [
  "fillField",
  "selectOption",
  "flagIssue",
  "requestUserApproval",
  "validateApplication",
  "researchCompany",
];

/** Description handed to the model so it knows what it may call. */
export const TOOL_MANIFEST = [
  {
    name: "fillField",
    args: { fieldId: "string", value: "string" },
    description:
      "Write a text value into a non-sensitive text, email, url, textarea or tags field.",
  },
  {
    name: "selectOption",
    args: { fieldId: "string", value: "string" },
    description:
      "Choose one of the allowed options for a non-sensitive select field.",
  },
  {
    name: "flagIssue",
    args: { fieldId: "string", message: "string" },
    description: "Surface a problem with a field to the user without changing it.",
  },
  {
    name: "requestUserApproval",
    args: { fieldId: "string", reason: "string" },
    description:
      "Hand a sensitive field back to the user. The only legal way to address a sensitive field.",
  },
  {
    name: "validateApplication",
    args: {},
    description: "Re-run the full validation pass across the application.",
  },
  {
    name: "researchCompany",
    args: { reason: "string" },
    description:
      "Fetch external context about the company and role. Only worth calling when an answer depends on facts the profile and job description do not contain.",
  },
] as const;

export interface ToolResult {
  ok: boolean;
  /** Human-readable line for the activity panel. */
  message: string;
  detail?: string;
  state: ApplicationState;
  /** Field the user must now answer, if the tool requested approval. */
  approvalRequest?: { fieldId: string; reason: string };
  touchedFieldId?: string;
  /** Present on a successful write — feeds verification and the review screen. */
  change?: ChangeRecord;
}

function findField(
  state: ApplicationState,
  fieldId: unknown,
): ApplicationField | undefined {
  if (typeof fieldId !== "string") return undefined;
  return state.fields.find((f) => f.id === fieldId);
}

function writeField(
  state: ApplicationState,
  fieldId: string,
  value: string,
  byAgent: boolean,
): ApplicationState {
  const fields = state.fields.map((f) => {
    if (f.id !== fieldId) return f;
    return byAgent
      ? {
          ...f,
          value,
          filledByAgent: true,
          confidence: confidenceFor(f.level, f.type),
          reviewed: false,
        }
      : { ...f, value, filledByAgent: false, confidence: undefined, reviewed: true };
  });
  return deriveState(state, fields);
}

/**
 * Grounding check: outside of free-text answers, the agent may only write values
 * that actually exist in the user profile. It cannot invent personal data.
 */
function isGrounded(
  field: ApplicationField,
  value: string,
  profile: UserProfile,
): boolean {
  if (field.type === "textarea") return true;

  const normalize = (s: string) => s.trim().toLowerCase();
  const known = new Set(
    [
      profile.name,
      profile.email,
      profile.university,
      profile.degree,
      profile.minor,
      profile.graduationDate,
      profile.portfolio,
      profile.linkedin,
      profile.location,
      ...profile.skills,
      // Common composites the model may reasonably produce.
      `${profile.degree}, minor in ${profile.minor}`,
      `${profile.degree} (minor: ${profile.minor})`,
    ].map(normalize),
  );

  if (field.type === "tags") {
    const tokens = value
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    return tokens.length > 0 && tokens.every((t) => known.has(normalize(t)));
  }

  const v = normalize(value);
  // Trailing-slash tolerance for URLs.
  return known.has(v) || known.has(v.replace(/\/+$/, ""));
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;
}

/**
 * Executes one agent action against live application state.
 * Every branch validates before mutating: malformed or unsafe actions are refused.
 *
 * `researchCompany` is async and therefore handled by the orchestrator, not here.
 */
export function executeAction(
  state: ApplicationState,
  action: AgentAction,
  profile: UserProfile = userProfile,
): ToolResult {
  const refuse = (message: string, detail?: string): ToolResult => ({
    ok: false,
    message,
    detail,
    state,
  });

  if (!action || typeof action !== "object") {
    return refuse("Malformed action ignored");
  }
  if (!TOOL_NAMES.includes(action.tool)) {
    return refuse(`Unknown tool "${String(action.tool)}" ignored`);
  }
  if (action.tool === "researchCompany") {
    return refuse("researchCompany is handled by the orchestrator");
  }

  const args = action.args ?? {};

  switch (action.tool) {
    case "validateApplication": {
      const report = buildReport(state.fields);
      const errors = [...report.blockers, ...report.warnings];
      return {
        ok: true,
        message: "Application validated",
        detail:
          report.blockers.length === 0
            ? report.warnings.length === 0
              ? "No outstanding issues."
              : `${report.warnings.length} warning${report.warnings.length === 1 ? "" : "s"}, 0 blockers.`
            : `${report.blockers.length} blocker${report.blockers.length === 1 ? "" : "s"} remaining.`,
        state: { ...state, validationErrors: errors },
      };
    }

    case "flagIssue": {
      const field = findField(state, args.fieldId);
      if (!field) {
        return refuse(`Cannot flag unknown field "${String(args.fieldId)}"`);
      }
      const message = String(args.message ?? "").trim();
      if (!message) return refuse(`Issue flagged on ${field.label} had no message`);
      const already = state.validationErrors.some(
        (e) => e.fieldId === field.id && e.message === message,
      );
      return {
        ok: true,
        message: `Issue flagged on ${field.label}`,
        detail: message,
        touchedFieldId: field.id,
        state: already
          ? state
          : {
              ...state,
              validationErrors: [
                ...state.validationErrors,
                { fieldId: field.id, message, severity: "warning" },
              ],
            },
      };
    }

    case "requestUserApproval": {
      const field = findField(state, args.fieldId);
      if (!field) {
        return refuse(
          `Cannot request approval for unknown field "${String(args.fieldId)}"`,
        );
      }
      const reason =
        field.sensitiveReason ??
        String(args.reason ?? "This answer requires the applicant's decision.");
      return {
        ok: true,
        message: `${field.label.replace(/\?$/, "")} requires user input`,
        detail: reason,
        touchedFieldId: field.id,
        approvalRequest: { fieldId: field.id, reason },
        state,
      };
    }

    case "fillField":
    case "selectOption": {
      const field = findField(state, args.fieldId);
      if (!field) {
        return refuse(`Cannot write to unknown field "${String(args.fieldId)}"`);
      }

      // Hard guard: the model can ask, but it can never write a sensitive field.
      if (field.sensitive) {
        const reason =
          field.sensitiveReason ?? "This answer requires the applicant's decision.";
        return {
          ok: false,
          message: `Blocked: ${field.label.replace(/\?$/, "")} is user-only`,
          detail: "SCREENMATE does not answer sensitive questions automatically.",
          touchedFieldId: field.id,
          approvalRequest: { fieldId: field.id, reason },
          state,
        };
      }

      const value = typeof args.value === "string" ? args.value.trim() : "";
      if (!value) return refuse(`Empty value rejected for ${field.label}`);

      const isSelect = field.type === "select";
      if (action.tool === "selectOption" && !isSelect) {
        return refuse(`${field.label} is not a select field`);
      }
      if (action.tool === "fillField" && isSelect) {
        return refuse(`${field.label} must be set with selectOption`);
      }
      if (isSelect && field.options && !field.options.includes(value)) {
        return refuse(
          `"${value}" is not a valid option for ${field.label}`,
          `Allowed: ${field.options.join(", ")}`,
        );
      }
      if (!isGrounded(field, value, profile)) {
        return refuse(
          `Blocked ungrounded value for ${field.label}`,
          "Value was not present in the user profile.",
        );
      }
      if (hasValue(field) && field.value === value) {
        return refuse(`${field.label} already set`, "No change needed.");
      }

      const before = field.value;
      const next = writeField(state, field.id, value, true);
      const verb = field.type === "tags" ? "selected" : "completed";
      return {
        ok: true,
        message: `${field.label.replace(/\?$/, "")} ${verb}`,
        detail: field.type === "textarea" ? truncate(value, 120) : value,
        touchedFieldId: field.id,
        state: next,
        change: {
          fieldId: field.id,
          label: field.label,
          before,
          after: value,
          level: field.level,
          confidence: confidenceFor(field.level, field.type),
          verified: false,
          regenerable: field.type === "textarea",
        },
      };
    }
  }
}

/**
 * Re-reads application state after a write and confirms the environment
 * actually reflects what the tool claimed to do.
 *
 * This is deliberately independent of executeAction's return value — it checks
 * the state that came back, not the state the tool thought it produced.
 */
export function verifyAction(
  state: ApplicationState,
  fieldId: string,
  expected: string,
): VerifyResult {
  const field = state.fields.find((f) => f.id === fieldId);
  const checks: VerifyCheck[] = [];

  checks.push({ label: "Field exists", ok: Boolean(field) });

  const valueMatches = field?.value?.trim() === expected.trim();
  checks.push({ label: "Value committed to state", ok: valueMatches });

  const blockers = state.validationErrors.filter(
    (e) => e.fieldId === fieldId && e.severity !== "warning",
  );
  checks.push({ label: "No validation error raised", ok: blockers.length === 0 });

  const counted = field ? hasValue(field) : false;
  checks.push({ label: "Counted as complete", ok: counted });

  const ok = checks.every((c) => c.ok);
  return {
    ok,
    checks,
    summary: ok
      ? "Field update confirmed"
      : (checks.find((c) => !c.ok)?.label ?? "Verification failed"),
  };
}

/** User-driven edits go through here so provenance stays correct. */
export function setFieldByUser(
  state: ApplicationState,
  fieldId: string,
  value: string,
): ApplicationState {
  return writeField(state, fieldId, value, false);
}

/** Marks an agent-written value as accepted by the user during review. */
export function acceptField(
  state: ApplicationState,
  fieldId: string,
): ApplicationState {
  const fields = state.fields.map((f) =>
    f.id === fieldId ? { ...f, reviewed: true } : f,
  );
  return deriveState(state, fields);
}

/** Reverts an agent-written value the user rejected in review. */
export function revertField(
  state: ApplicationState,
  fieldId: string,
  before: string | null,
): ApplicationState {
  const fields = state.fields.map((f) =>
    f.id === fieldId
      ? {
          ...f,
          value: before,
          filledByAgent: false,
          confidence: undefined,
          reviewed: true,
        }
      : f,
  );
  return deriveState(state, fields);
}
