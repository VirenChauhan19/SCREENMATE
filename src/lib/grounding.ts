import type { UserProfile } from "./types";

/**
 * Anti-hallucination guard, shared by the in-app tool layer and the server-side
 * filter that protects the Chrome extension.
 *
 * Outside free-text answers, the agent may only write values that already exist
 * in the user's profile. It cannot invent a school, a date, a URL, or a skill.
 */

const normalize = (s: string) => s.trim().toLowerCase();

/** Profile values are arbitrary in the extension, so accept a loose shape. */
export type ProfileLike =
  | UserProfile
  | Record<string, string | string[] | undefined>;

export function knownValues(profile: ProfileLike): Set<string> {
  const flat: string[] = [];
  for (const value of Object.values(profile)) {
    if (typeof value === "string") flat.push(value);
    else if (Array.isArray(value)) flat.push(...value);
  }

  // Composites the model may reasonably assemble from two profile values.
  const degree = (profile as UserProfile).degree;
  const minor = (profile as UserProfile).minor;
  if (degree && minor) {
    flat.push(`${degree}, minor in ${minor}`, `${degree} (minor: ${minor})`);
  }

  // Forms that split the name ask for part of it. Any run of its words is
  // still the user's own name, never an invented one.
  const name = (profile as UserProfile).name;
  if (typeof name === "string") {
    const words = name.trim().split(/\s+/);
    for (let i = 0; i < words.length; i++) {
      for (let j = i + 1; j <= words.length; j++) {
        flat.push(words.slice(i, j).join(" "));
      }
    }
  }

  return new Set(flat.filter(Boolean).map(normalize));
}

const digits = (s: string) => s.replace(/\D/g, "");

/**
 * The profile's phone number, written the way this form wants it. Only the
 * punctuation may differ, or the country code may be left to a separate
 * country-code field. No digit is ever added or changed.
 */
function isProfilePhone(value: string, profile: ProfileLike): boolean {
  const stored = (profile as Record<string, unknown>).phone;
  if (typeof stored !== "string" || !/^\+?[\d\s().-]+$/.test(value.trim())) {
    return false;
  }
  const want = digits(stored);
  const got = digits(value);
  if (got.length < 7) return false;
  if (got === want) return true;

  const dropped = want.length - got.length;
  return (
    stored.trim().startsWith("+") &&
    dropped >= 1 &&
    dropped <= 3 &&
    want.endsWith(got)
  );
}

/**
 * `fieldType` follows the in-app vocabulary: "textarea" is free text and is
 * always allowed; "tags" is a comma-separated list checked token by token.
 */
export function isGroundedValue(
  fieldType: string,
  value: string,
  profile: ProfileLike,
): boolean {
  if (fieldType === "textarea") return true;

  const known = knownValues(profile);

  const allTokensKnown = (raw: string) => {
    const tokens = raw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    return tokens.length > 0 && tokens.every((t) => known.has(normalize(t)));
  };

  if (fieldType === "tags") return allTokensKnown(value);

  const v = normalize(value);
  // Trailing-slash tolerance for URLs.
  if (known.has(v) || known.has(v.replace(/\/+$/, ""))) return true;
  if (isProfilePhone(value, profile)) return true;

  // On a page we did not design, a skills field is just type="text". A comma
  // list is still fully grounded as long as every item came from the profile —
  // this widens what we accept without letting anything be invented.
  return value.includes(",") && allTokensKnown(value);
}
