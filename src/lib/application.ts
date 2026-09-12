import { isSensitiveTopic, levelFor } from "./policy";
import type {
  ApplicationField,
  ApplicationState,
  SectionId,
  ValidationCheck,
  ValidationError,
  ValidationReport,
} from "./types";

export const SECTIONS: { id: SectionId; label: string; hint: string }[] = [
  { id: "personal", label: "Personal", hint: "Basic contact details" },
  { id: "education", label: "Education", hint: "Current or most recent program" },
  { id: "professional", label: "Professional", hint: "Work and portfolio links" },
  { id: "role", label: "Role Questions", hint: "Specific to this opening" },
];

export interface RoleDefinition {
  id: string;
  jobTitle: string;
  company: string;
  jobDescription: string;
}

/**
 * Two openings at the same company. Switching between them invalidates any
 * research the agent has already gathered — that is the point of having two.
 */
export const ROLES: RoleDefinition[] = [
  {
    id: "swe-intern",
    jobTitle: "Software Developer Intern",
    company: "Nova Systems",
    jobDescription:
      "Nova Systems is hiring a Software Developer Intern to work alongside our platform team. " +
      "You will help build internal tooling and customer-facing interfaces in TypeScript and React, " +
      "write Python services that support our simulation pipeline, and contribute to early experiments " +
      "integrating AI models into engineering workflows. We look for interns who can ship end-to-end, " +
      "reason about real systems, and communicate clearly. Hybrid, Atlanta GA. Summer 2026.",
  },
  {
    id: "design-eng-intern",
    jobTitle: "Design Engineering Intern",
    company: "Nova Systems",
    jobDescription:
      "Nova Systems is hiring a Design Engineering Intern to sit between our design and platform teams. " +
      "You will prototype interfaces in React, build and maintain our component library, and turn " +
      "simulation output into interactive visualizations engineers actually use. Strong visual judgment " +
      "and comfort in production TypeScript both matter. Hybrid, Atlanta GA. Summer 2026.",
  },
];

export const DEFAULT_ROLE_ID = ROLES[0].id;

export function roleById(roleId: string): RoleDefinition {
  return ROLES.find((r) => r.id === roleId) ?? ROLES[0];
}

/** Fields the agent may never populate on its own. */
const SENSITIVE_REASONS: Record<string, string> = {
  sponsorship:
    "Immigration and work-authorization status is a legal declaration only you can make.",
  relocation:
    "A relocation commitment is a personal obligation, not something inferable from your profile.",
};

type FieldSeed = Omit<ApplicationField, "sensitive" | "level"> &
  Partial<Pick<ApplicationField, "sensitive" | "level">>;

function seedFields(): FieldSeed[] {
  return [
    // PERSONAL — partly pre-filled, like a portal that already knows you.
    {
      id: "fullName",
      label: "Full Name",
      type: "text",
      section: "personal",
      value: "Viren Chauhan",
      required: true,
      placeholder: "Jane Doe",
    },
    {
      id: "email",
      label: "Email",
      type: "email",
      section: "personal",
      value: "viren@example.com",
      required: true,
      placeholder: "you@domain.com",
    },
    {
      id: "location",
      label: "Location",
      type: "text",
      section: "personal",
      value: null,
      required: true,
      placeholder: "City, State",
    },

    // EDUCATION
    {
      id: "university",
      label: "University",
      type: "text",
      section: "education",
      value: "SCAD",
      required: true,
      placeholder: "Institution name",
    },
    {
      id: "degree",
      label: "Degree",
      type: "text",
      section: "education",
      value: null,
      required: true,
      placeholder: "e.g. BFA Game Design",
    },
    {
      id: "graduationDate",
      label: "Graduation Date",
      type: "text",
      section: "education",
      value: null,
      required: true,
      placeholder: "YYYY",
    },

    // PROFESSIONAL
    {
      id: "portfolio",
      label: "Portfolio URL",
      type: "url",
      section: "professional",
      value: null,
      required: true,
      placeholder: "https://",
    },
    {
      id: "linkedin",
      label: "LinkedIn",
      type: "url",
      section: "professional",
      value: null,
      required: false,
      placeholder: "https://linkedin.com/in/",
    },
    {
      id: "skills",
      label: "Skills",
      type: "tags",
      section: "professional",
      value: null,
      required: true,
      placeholder: "Comma-separated",
    },

    // ROLE QUESTIONS
    {
      id: "motivation",
      label: "Why are you interested in this role?",
      type: "textarea",
      section: "role",
      value: null,
      required: true,
      placeholder: "A few sentences.",
      maxLength: 900,
    },
    {
      id: "sponsorship",
      label: "Will you now or in the future require employment sponsorship?",
      type: "select",
      section: "role",
      value: null,
      required: true,
      options: ["Yes", "No"],
    },
    {
      id: "relocation",
      label: "Are you willing to relocate?",
      type: "select",
      section: "role",
      value: null,
      required: true,
      options: ["Yes", "No"],
    },
  ];
}

/** Applies the policy layer so `level` and `sensitive` can never drift apart. */
function applyPolicy(seed: FieldSeed): ApplicationField {
  const level = levelFor(seed.id, seed.label, seed.type);
  const sensitive = level === "sensitive";
  return {
    ...seed,
    level,
    sensitive,
    sensitiveReason: sensitive
      ? (SENSITIVE_REASONS[seed.id] ??
        (isSensitiveTopic(seed.id, seed.label)
          ? "This question touches a protected or personal topic."
          : "This answer requires the applicant's decision."))
      : undefined,
  };
}

export function createInitialState(roleId = DEFAULT_ROLE_ID): ApplicationState {
  const role = roleById(roleId);
  const fields = seedFields().map(applyPolicy);
  return {
    roleId: role.id,
    jobTitle: role.jobTitle,
    company: role.company,
    jobDescription: role.jobDescription,
    fields,
    validationErrors: [],
    completedFields: countCompleted(fields),
    totalFields: fields.length,
  };
}

export function countCompleted(fields: ApplicationField[]): number {
  return fields.filter((f) => hasValue(f)).length;
}

export function hasValue(field: ApplicationField): boolean {
  return field.value !== null && field.value.trim().length > 0;
}

const URL_RE = /^https?:\/\/[^\s.]+\.[^\s]{2,}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PLACEHOLDER_RE = /\b(lorem ipsum|\[your |xxx+|tbd|todo)\b/i;

/** Pure validation — used by the validateApplication tool and by the UI. */
export function validateFields(fields: ApplicationField[]): ValidationError[] {
  const report = buildReport(fields);
  return [...report.blockers, ...report.warnings];
}

/**
 * The full application check. Every rule contributes both a pass/fail line for
 * the summary panel and, when it fails, a field-level error for the form.
 */
export function buildReport(fields: ApplicationField[]): ValidationReport {
  const blockers: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  const push = (
    list: ValidationError[],
    fieldId: string,
    message: string,
    severity: "blocker" | "warning",
  ) => list.push({ fieldId, message, severity });

  const required = fields.filter((f) => f.required);
  const missingRequired = required.filter((f) => !hasValue(f));
  for (const f of missingRequired) {
    push(blockers, f.id, `${f.label.replace(/\?$/, "")} is required.`, "blocker");
  }

  const badUrls: ApplicationField[] = [];
  const badEmails: ApplicationField[] = [];
  const badOptions: ApplicationField[] = [];
  const tooLong: ApplicationField[] = [];
  const placeholders: ApplicationField[] = [];

  for (const field of fields) {
    if (!hasValue(field)) continue;
    const value = field.value as string;

    if (field.type === "url" && !URL_RE.test(value)) {
      badUrls.push(field);
      push(blockers, field.id, "Enter a full URL including https://", "blocker");
    }
    if (field.type === "email" && !EMAIL_RE.test(value)) {
      badEmails.push(field);
      push(blockers, field.id, "Enter a valid email address.", "blocker");
    }
    if (field.type === "select" && field.options && !field.options.includes(value)) {
      badOptions.push(field);
      push(
        blockers,
        field.id,
        `Choose one of: ${field.options.join(", ")}.`,
        "blocker",
      );
    }
    if (field.maxLength && value.length > field.maxLength) {
      tooLong.push(field);
      push(
        warnings,
        field.id,
        `${value.length} characters — ${field.maxLength} is the recommended limit.`,
        "warning",
      );
    }
    if (PLACEHOLDER_RE.test(value)) {
      placeholders.push(field);
      push(warnings, field.id, "This looks like placeholder text.", "warning");
    }
  }

  const unresolvedSensitive = fields.filter(
    (f) => f.sensitive && f.required && !hasValue(f),
  );

  const unreviewed = fields.filter(
    (f) => f.filledByAgent && f.level === "review" && !f.reviewed && hasValue(f),
  );
  for (const f of unreviewed) {
    push(warnings, f.id, "Agent suggestion still awaiting your review.", "warning");
  }

  const checks: ValidationCheck[] = [
    {
      id: "required",
      label: "Required fields complete",
      ok: missingRequired.length === 0,
      detail:
        missingRequired.length === 0
          ? `${required.length} of ${required.length} answered`
          : `${missingRequired.length} still empty`,
    },
    {
      id: "urls",
      label: "URLs valid",
      ok: badUrls.length === 0,
      detail: badUrls.length === 0 ? undefined : `${badUrls.length} malformed`,
    },
    {
      id: "email",
      label: "Email format valid",
      ok: badEmails.length === 0,
      detail: badEmails.length === 0 ? undefined : `${badEmails.length} malformed`,
    },
    {
      id: "options",
      label: "Selections within allowed options",
      ok: badOptions.length === 0,
      detail: badOptions.length === 0 ? undefined : `${badOptions.length} invalid`,
    },
    {
      id: "sensitive",
      label: "No unresolved sensitive questions",
      ok: unresolvedSensitive.length === 0,
      detail:
        unresolvedSensitive.length === 0
          ? undefined
          : `${unresolvedSensitive.length} awaiting your decision`,
    },
    {
      id: "limits",
      label: "Character limits satisfied",
      ok: tooLong.length === 0,
      detail: tooLong.length === 0 ? undefined : `${tooLong.length} over limit`,
    },
    {
      id: "consistency",
      label: "No placeholder or filler text",
      ok: placeholders.length === 0,
      detail:
        placeholders.length === 0 ? undefined : `${placeholders.length} suspicious`,
    },
    {
      id: "reviewed",
      label: "Agent suggestions reviewed",
      ok: unreviewed.length === 0,
      detail: unreviewed.length === 0 ? undefined : `${unreviewed.length} pending`,
    },
  ];

  return { checks, blockers, warnings };
}

/** Recomputes derived counters so ApplicationState is never stale. */
export function deriveState(
  state: ApplicationState,
  fields: ApplicationField[],
): ApplicationState {
  const report = buildReport(fields);
  return {
    ...state,
    fields,
    completedFields: countCompleted(fields),
    totalFields: fields.length,
    validationErrors: [...report.blockers, ...report.warnings],
  };
}
