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

  return new Set(flat.filter(Boolean).map(normalize));
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

  // On a page we did not design, a skills field is just type="text". A comma
  // list is still fully grounded as long as every item came from the profile —
  // this widens what we accept without letting anything be invented.
  return value.includes(",") && allTokensKnown(value);
}
