/**
 * Links, addresses and dotted names ("Next.js", "e.g.") that a punctuation
 * rule must never touch: "https://github.com/x" once came out as
 * "https: //github. com/x" and went into a real application that way.
 */
const PROTECTED =
  /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|\b[\w-]+(?:\.[\w-]+)+(?:\/[^\s<>"')\]]*)?/gi;

/**
 * Deterministic cleanup of generated prose.
 *
 * The prompt asks for no em-dashes and the model still reaches for them, so we
 * remove the tells we can fix mechanically rather than hoping.
 */
export function polish(text: string): string {
  // Set links and dotted names aside, clean the prose around them, put them back.
  const kept: string[] = [];
  const masked = text.replace(PROTECTED, (m) => `\u0000${kept.push(m) - 1}\u0000`);
  const cleaned = masked
    // "background—thinking about X—actually" → parenthetical commas
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/,\s*,/g, ",")
    .replace(/\s+([,;!?])/g, "$1")
    // Only commas and semicolons glued to the next word: a full stop may be
    // part of an abbreviation, and a colon part of a time.
    .replace(/([,;])(?=[A-Za-z])/g, "$1 ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return cleaned.replace(/\u0000(\d+)\u0000/g, (_, i) => kept[Number(i)]);
}
