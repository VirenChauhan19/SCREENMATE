import type { ActionLevel, Confidence } from "./policy";

export type FieldType = "text" | "email" | "url" | "textarea" | "select" | "tags";

export interface ApplicationField {
  id: string;
  label: string;
  type: FieldType;
  section: SectionId;
  value: string | null;
  required: boolean;
  /** Derived from policy.levelFor — kept for the Part 1 guards that read it. */
  sensitive: boolean;
  level: ActionLevel;
  placeholder?: string;
  /** For type === "select" */
  options?: string[];
  /** Why this field is sensitive — surfaced in the approval card. */
  sensitiveReason?: string;
  /** Set when SCREENMATE wrote the value (vs. the user). */
  filledByAgent?: boolean;
  /** How directly the agent's value traces back to profile data. */
  confidence?: Confidence;
  /** True once the user has accepted an agent-written value in review. */
  reviewed?: boolean;
  /** Soft cap used by the final validation pass. */
  maxLength?: number;
}

export type SectionId = "personal" | "education" | "professional" | "role";

export interface ApplicationState {
  roleId: string;
  jobTitle: string;
  company: string;
  jobDescription: string;
  fields: ApplicationField[];
  validationErrors: ValidationError[];
  completedFields: number;
  totalFields: number;
}

export type Severity = "blocker" | "warning";

export interface ValidationError {
  fieldId: string;
  message: string;
  severity?: Severity;
}

export interface ValidationCheck {
  id: string;
  label: string;
  ok: boolean;
  detail?: string;
}

export interface ValidationReport {
  checks: ValidationCheck[];
  blockers: ValidationError[];
  warnings: ValidationError[];
}

export interface UserProfile {
  name: string;
  email: string;
  university: string;
  degree: string;
  minor: string;
  graduationDate: string;
  portfolio: string;
  linkedin: string;
  location: string;
  skills: string[];
}

/* ---------------- Research ---------------- */

export interface ResearchSource {
  title: string;
  url: string;
  excerpt: string;
  relevance: string;
}

export interface ResearchContext {
  companySummary: string;
  technicalFocus: string[];
  relevantContext: string[];
  sources: ResearchSource[];
  degraded?: boolean;
  /** The role this research was gathered for — used to detect staleness. */
  roleId?: string;
}

/* ---------------- Agent ---------------- */

export type ToolName =
  | "fillField"
  | "selectOption"
  | "flagIssue"
  | "requestUserApproval"
  | "validateApplication"
  | "researchCompany";

export interface AgentAction {
  tool: ToolName;
  args: Record<string, string>;
  /** Model-assigned, re-derived from policy before anything executes. */
  confidence?: Confidence;
  rationale?: string;
}

export type PlanStepKind =
  | "observe"
  | "research"
  | "fill"
  | "generate"
  | "approval"
  | "verify"
  | "review"
  | "validate";

export type PlanStepStatus = "pending" | "active" | "done" | "skipped";

export interface PlanStep {
  kind: PlanStepKind;
  label: string;
  status: PlanStepStatus;
}

/** Phase 1 of the agent loop: goal, plan, and whether research is warranted. */
export interface AgentPlan {
  goal: string;
  observation: string;
  steps: { kind: PlanStepKind; label: string }[];
  researchNeeded: boolean;
  researchRationale: string;
}

/** Phase 2 of the agent loop: the concrete tool calls. */
export interface AgentActionPlan {
  decisionSummary: string;
  actions: AgentAction[];
  requiresUserApproval: boolean;
}

/* ---------------- Verification ---------------- */

export interface VerifyCheck {
  label: string;
  ok: boolean;
}

export interface VerifyResult {
  ok: boolean;
  checks: VerifyCheck[];
  summary: string;
}

/* ---------------- Review ---------------- */

export interface ChangeRecord {
  fieldId: string;
  label: string;
  before: string | null;
  after: string;
  level: ActionLevel;
  confidence: Confidence;
  verified: boolean;
  /** Free-text answers can be regenerated or hand-edited during review. */
  regenerable: boolean;
}

/* ---------------- Activity log ---------------- */

export type ActivityKind =
  | "observe"
  | "research"
  | "success"
  | "think"
  | "action"
  | "write"
  | "lock"
  | "warn"
  | "verify"
  | "context";

export interface ActivityEntry {
  id: string;
  kind: ActivityKind;
  message: string;
  detail?: string;
  at: number;
  /** Renders as a nested sub-line under the action it verifies. */
  nested?: boolean;
}

export type AgentStatus =
  | "idle"
  | "observing"
  | "researching"
  | "planning"
  | "acting"
  | "verifying"
  | "waiting"
  | "reviewing"
  | "complete"
  | "error";

/* ---------------- Run summary ---------------- */

export interface RunStats {
  safeFields: number;
  researchedResponses: number;
  reviewedSuggestions: number;
  userDecisions: number;
  verifiedActions: number;
  sourcesUsed: number;
}
