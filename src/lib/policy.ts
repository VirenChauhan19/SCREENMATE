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
  "authorized to work",
  "authorised to work",
  "legally authoriz",
  "legally authoris",
  "eligible to work",
  "right to work",
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

/**
 * `fieldType` matters on pages the policy has never seen: an id like
 * `question_48219` tells us nothing, but a textarea is free text by
 * definition, which is generated rather than copied and therefore REVIEW.
 */
/**
 * Canonical topics for the questions every application asks. A stored answer is
 * keyed by topic, so the preference you set once on one site matches the same
 * question worded differently on the next.
 */
export const PREFERENCE_TOPICS = [
  "workAuthorization",
  "sponsorship",
  "relocation",
  "remotePreference",
  "salary",
  "startDate",
  "noticePeriod",
  "gender",
  "ethnicity",
  "veteran",
  "disability",
  "criminalHistory",
  "referralSource",
] as const;

export type PreferenceTopic = (typeof PREFERENCE_TOPICS)[number];

const TOPIC_MATCHERS: { topic: PreferenceTopic; match: RegExp }[] = [
  // Order matters: sponsorship must win over the broader work-authorization test.
  { topic: "sponsorship", match: /sponsor|visa support|h-?1b/i },
  {
    topic: "workAuthorization",
    match: /legally (authori|entitled)|work authori[sz]ation|right to work|eligible to work|citizenship/i,
  },
  { topic: "relocation", match: /relocat/i },
  { topic: "remotePreference", match: /remote|hybrid|on-?site preference|work location preference/i },
  { topic: "salary", match: /salary|compensation|pay expectation|desired (base|rate)|hourly rate/i },
  { topic: "startDate", match: /start date|available to start|availability date|earliest start/i },
  { topic: "noticePeriod", match: /notice period|notice required/i },
  { topic: "gender", match: /gender|sex/i },
  { topic: "ethnicity", match: /ethnic|race|hispanic|latino/i },
  { topic: "veteran", match: /veteran|military service/i },
  { topic: "disability", match: /disabilit/i },
  { topic: "criminalHistory", match: /criminal|felony|conviction|background check/i },
  { topic: "referralSource", match: /how did you (hear|find)|referral source|where did you hear/i },
];

/** The standing-preference topic this field asks about, if any. */
export function topicFor(fieldId: string, label: string): PreferenceTopic | null {
  const haystack = `${fieldId} ${label}`;
  return TOPIC_MATCHERS.find((m) => m.match.test(haystack))?.topic ?? null;
}

export function levelFor(
  fieldId: string,
  label: string,
  fieldType?: string,
): ActionLevel {
  // A file upload is always the user's to do: we surface it, never fill it.
  if (fieldType === "file") return "sensitive";
  if (isSensitiveTopic(fieldId, label)) return "sensitive";

  // Every standing-answer question is a personal declaration, so it belongs to
  // the user even when the wording dodges the keyword list. Referral source is
  // the one preference that is merely a preference.
  const topic = topicFor(fieldId, label);
  if (topic && topic !== "referralSource") return "sensitive";

  const known = FIELD_LEVEL[fieldId];
  if (known) return known;
  return fieldType === "textarea" ? "review" : "safe";
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
