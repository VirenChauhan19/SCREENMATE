import type { ApplicationField } from "./types";

// Scoped to the applicant, and the complete question (including country or
// employer wording). A topic keyword alone is not enough to replay a decision.
function memoryKey(applicant: string, field: ApplicationField): string {
  const question = field.label.toLowerCase().replace(/\s+/g, " ").replace(/[?*:.\s]+$/g, "");
  return `screenmate:answer:v1:${JSON.stringify([applicant, field.id, question])}`;
}

export function answerStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

export function recalledAnswer(storage: Storage | null, applicant: string, field: ApplicationField): string | null {
  try {
    const answer = storage?.getItem(memoryKey(applicant, field));
    return answer && field.options?.includes(answer) ? answer : null;
  } catch {
    return null;
  }
}

export function rememberAnswer(storage: Storage | null, applicant: string, field: ApplicationField, value: string, remember: boolean): boolean {
  try {
    if (!storage) return false;
    const key = memoryKey(applicant, field);
    if (remember && field.options?.includes(value)) storage.setItem(key, value);
    else storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
