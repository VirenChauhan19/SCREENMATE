/**
 * The single source of truth for what SCREENMATE is allowed to do.
 *
 * Every guard in the system reads from this file. Changing a field's level here
 * changes the agent's behaviour everywhere: the prompt, the server-side rewrite,
 * the tool layer, and the UI badges.
 */

export type ActionLevel = "safe" | "review" | "sensitive";
export type Confidence = "high" | "medium" | "user";

export const LEVEL_COPY: Record<
  ActionLevel,
  { label: string; blurb: string }
> = {
  safe: {
    label: "Safe",
    blurb: "Executed automatically from stored profile data.",
  },
  review: {
    label: "Review",
    blurb: "Prepared by the agent, surfaced for your approval before it stands.",
  },
  sensitive: {
    label: "Sensitive",
    blurb: "Never answered automatically. Requires your explicit decision.",
  },
};

export const CONFIDENCE_COPY: Record<
  Confidence,
  { label: string; note: string }
> = {
  high: { label: "High confidence", note: "Auto-completed" },
  medium: { label: "Medium confidence", note: "Review recommended" },
  user: { label: "User required", note: "Not completed automatically" },
};

/**
 * Field-level policy. Anything not listed defaults to `safe`, but a field that
 * matches SENSITIVE_TOPICS is forced to `sensitive` regardless.
 */
const FIELD_LEVEL: Record<string, ActionLevel> = {
  fullName: "safe",
  email: "safe",
  location: "safe",
  university: "safe",
  degree: "safe",
  graduationDate: "safe",
  portfolio: "safe",
  linkedin: "safe",

  // Assembled by the agent rather than copied verbatim.
  skills: "review",
  motivation: "review",

  sponsorship: "sensitive",
  relocation: "sensitive",
};

/**
 * Topic guard. Any field whose id or label touches these subjects is sensitive
 * even if someone forgets to list it above — new fields fail closed, not open.
 */
const SENSITIVE_TOPICS = [
  "sponsor",
  "work authorization",
  "work authorisation",
  "visa",
  "citizenship",
  "immigration",
  "disability",
  "veteran",
  "gender",
  "race",
  "ethnicity",
  "demographic",
  "salary",
  "compensation",
  "pay expectation",
  "relocate",
  "relocation",
  "criminal",
  "felony",
  "date of birth",
];

export function isSensitiveTopic(fieldId: string, label: string): boolean {
  const haystack = `${fieldId} ${label}`.toLowerCase();
  return SENSITIVE_TOPICS.some((topic) => haystack.includes(topic));
}

export function levelFor(fieldId: string, label: string): ActionLevel {
  if (isSensitiveTopic(fieldId, label)) return "sensitive";
  return FIELD_LEVEL[fieldId] ?? "safe";
}

/**
 * Confidence is a property of the action, not the field: it reflects how
 * directly the written value traces back to stored profile data.
 *
 * - high   — copied verbatim from one profile value
 * - medium — assembled, inferred, or generated from several inputs
 * - user   — the agent may not decide this at all
 */
export function confidenceFor(
  level: ActionLevel,
  fieldType: string,
): Confidence {
  if (level === "sensitive") return "user";
  if (level === "review") return "medium";
  // Free text is never a verbatim copy, even on a safe field.
  return fieldType === "textarea" ? "medium" : "high";
}

/** Fields at this level may be written without asking first. */
export function canAutoExecute(level: ActionLevel): boolean {
  return level !== "sensitive";
}

/** Fields at this level must appear in the review step before they stand. */
export function needsReview(level: ActionLevel): boolean {
  return level === "review";
}
