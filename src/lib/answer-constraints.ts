/** Limits stated by the actual question, its help text, or the native input. */
export interface AnswerField {
  label: string;
  instructions?: string;
  maxLength?: number;
}

export function answerLimits(field: AnswerField) {
  const hints = `${field.label} ${field.instructions || ""}`;
  const defaultCap = /cover\s*letter/i.test(field.label) ? 3000 : 1600;
  const nativeCap = Number.isInteger(field.maxLength) && field.maxLength! >= 0 ? Math.min(12000, field.maxLength!) : 12000;
  let statedMaxChars: number | undefined;
  let minChars: number | undefined;
  let maxWords: number | undefined;
  let minWords: number | undefined;

  const addLimit = (raw: string, unit: string, minimum: boolean) => {
    const amount = Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(amount) || amount < 0) return;
    if (/^word/i.test(unit)) {
      if (minimum) minWords = Math.max(minWords ?? 0, amount);
      else maxWords = Math.min(maxWords ?? Infinity, amount);
    } else if (minimum) minChars = Math.max(minChars ?? 0, amount);
    else statedMaxChars = Math.min(statedMaxChars ?? Infinity, amount);
  };

  // Ranges express both bounds. The general number/unit pass below also sees
  // the upper bound, which simply reinforces the same maximum.
  for (const match of hints.matchAll(/\b(\d[\d,]*)\s*(?:[-–—]|to)\s*(\d[\d,]*)\s*(words?|characters?|chars?)\b/gi)) {
    addLimit(match[1], match[3], true);
    addLimit(match[2], match[3], false);
  }
  for (const match of hints.matchAll(/\b(\d[\d,]*)\s*[- ]?\s*(words?|characters?|chars?)\b/gi)) {
    const before = hints.slice(Math.max(0, match.index! - 40), match.index);
    const after = hints.slice(match.index! + match[0].length, match.index! + match[0].length + 24);
    const minimum = /(?:at least|minimum(?: of)?|no fewer than|not less than|min)\s*[:=]?\s*$/i.test(before) ||
      /^\s*(?:minimum|min)\b/i.test(after);
    addLimit(match[1], match[2], minimum);
  }
  // Common accessible help strings put the unit before the count.
  for (const match of hints.matchAll(/\b(words?|characters?|chars?)\s+(minimum|min|maximum|max|limit)(?:\s+(?:of|is))?\s*[:=]?\s*(\d[\d,]*)\b/gi)) {
    addLimit(match[3], match[1], /^min/i.test(match[2]));
  }
  for (const match of hints.matchAll(/\b(minimum|min|maximum|max)\s+(words?|characters?|chars?)\s*[:=]?\s*(\d[\d,]*)\b/gi)) {
    addLimit(match[3], match[2], /^min/i.test(match[1]));
  }

  // Give requested longer answers room, while retaining the native maxlength
  // and the bounded generation cap. Contradictory limits stay contradictory:
  // we must not silently lower a minimum to make an undersized answer pass.
  const requestedCap = statedMaxChars ?? Math.max(defaultCap,
    Math.ceil((minChars || 0) * 1.5), (minWords || 0) * 12, (maxWords || 0) * 12);
  const maxChars = Math.min(nativeCap, requestedCap);
  return { maxChars, minChars, maxWords, minWords };
}

export function answerFits(field: AnswerField, value: string): boolean {
  const { maxChars, minChars, maxWords, minWords } = answerLimits(field);
  const words = value.trim().split(/\s+/).filter(Boolean).length;
  return Boolean(value.trim()) && value.length <= maxChars &&
    (minChars === undefined || value.trim().length >= minChars) &&
    (maxWords === undefined || words <= maxWords) && (minWords === undefined || words >= minWords) &&
    !/\[(?:insert|your |company(?: name)?|job title|project name|name here)[^\]]*\]/i.test(value);
}

export function answerLimitText(field: AnswerField): string {
  const { maxChars, minChars, maxWords, minWords } = answerLimits(field);
  return [`at most ${maxChars} characters`, minChars !== undefined ? `at least ${minChars} characters` : "",
    maxWords !== undefined ? `at most ${maxWords} words` : "", minWords !== undefined ? `at least ${minWords} words` : ""].filter(Boolean).join("; ");
}
