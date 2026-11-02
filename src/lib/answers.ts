/**
 * A text box's HTML tag does not tell us whether an answer may be drafted.
 * Employers use one-line inputs for essays and textareas for addresses/history.
 * Only recognized written questions can use generated prose. Policy decides
 * separately whether the subject requires a personal decision.
 */
const normalizeQuestion = (label: string) => label.normalize("NFKC")
  .replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();

export function isNarrativeField(fieldType: string, label = ""): boolean {
  if (!["text", "textarea"].includes(fieldType)) return false;
  const question = normalizeQuestion(label);
  if (!question) return false;

  // A textarea or a leading "describe" must not turn a factual identifier into
  // permission to manufacture one. A plain work-history field stays copy-only.
  if (/\b(e-?mail address|postal address|mailing address|street address|date of birth|employer name|name of (?:your )?(?:current |previous )?employer|company name|reference name|phone number|telephone number)\b/.test(question)) return false;
  if (/^(?:(?:please|your|enter|provide|list)\s+)*(?:full name|first name|last name|name|address|employer|employers|work history|employment history|start date|end date|dates|school|university|degree|skills|links|portfolio|linkedin|github)\s*[:*?]?$/i.test(question)) return false;

  return [
    /\bwhy\b/,
    /\bwhat\b.*\b(interests? you|motivates? you|makes you|attract(?:s|ed|ing)? you|excit(?:es?|ed|ing)(?: you)?|(?:draws?|drawn|drew) you|appeals? to you|proudest|achievement|accomplishment|strengths?|contribut(?:e|ion)|bring)\b/,
    /\b(tell (?:us|me) (?:a (?:little|bit) )?about|describe|explain|summari[sz]e|outline|elaborate|discuss)\b/,
    /\b(?:share|give|provide)\b.*\b(example|story|project|experience|achievement|accomplishment|challenge|motivation)\b/,
    /\bhow\b.*\b(approach|solve|handle|contribute|overcome|resolve|manage|prioriti[sz]e|collaborate|fit|prepare|prepared|relate|match(?:es|ed|ing)?)\b/,
    /\b(?:cover|motivation) letter\b/,
    /\b(career goals|professional goals|statement of interest)\b/,
    /\breasons?[\s_-]*for[\s_-]*leaving\b/,
    /^(?:professional |personal |career )?(?:summary|bio|biography|statement)\s*[:*]?$/,
    /^(?:relevant |professional |work |project )?(?:experience|projects|achievements|accomplishments|responsibilities)\s*[:*]?$/,
    /^(?:additional|other|further) (?:information|details|comments)(?:\s|[:*?]|$)/,
    /\banything else\b.*\b(know|share|add)\b/,
  ].some(pattern => pattern.test(question));
}

/** These prompts need a real example or history, not a plausible invented one. */
export function narrativeNeedsExperience(label: string): boolean {
  const question = normalizeQuestion(label);
  if (/^(?:how would you|what would you|imagine|in a hypothetical)\b/.test(question)) return false;
  return /\b(experience|work history|employment history|previous roles|responsibilities|projects?|achievements?|accomplishments?|proudest|leadership|failures?|mistakes?|conflicts?)\b/.test(question) ||
    /\breasons?[\s_-]*for[\s_-]*leaving\b/.test(question) ||
    /\b(?:why|reasons?)\b.*\b(?:leav(?:e|ing)|left|depart(?:ed|ure)|resign(?:ed|ation)|fired|dismiss(?:ed|al)|terminat(?:ed|ion))\b/.test(question) ||
    /\b(?:describe|explain|share|tell|give|provide|outline|discuss)\b.*\b(?:a time|a situation|an example|specific example|challenge|you (?:led|solved|built|managed|delivered))\b/.test(question) ||
    /\bhow (?:did|have) you\b/.test(question);
}
