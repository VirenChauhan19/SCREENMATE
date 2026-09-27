import type { UserProfile } from "./types";

/**
 * Anti-hallucination guard, shared by the in-app tool layer and the server-side
 * filter that protects the Chrome extension.
 *
 * Outside free-text answers, the agent may only write values that already exist
 * in the user's profile. It cannot invent a school, a date, a URL, or a skill.
 */

const normalize = (s: string) => s.trim().toLowerCase();

/** A fact must come from the matching profile property, not just any property. */
export function factKeysFor(label: string, fieldType: string): string[] | null {
  const question = label.toLowerCase().replace(/\s*\((required|optional)\)\s*$/, "")
    .replace(/^(?:please enter|enter|what is|what's|your)\s+(?:your\s+)?/, "")
    .replace(/[?*:\s]+$/g, "");
  const keys: [RegExp, string[]][] = [
    [/^(?:full |full legal )?name$/, ['name']],
    [/^(?:first|given) name$/, ['firstName']],
    [/^(?:last|family) name$|^surname$/, ['lastName']],
    [/^(?:e-?mail)(?: address)?$/, ['email']],
    [/^(?:phone|telephone|mobile)(?: phone)?(?: number)?$/, ['phone']],
    [/^(?:university|school|college|school or university|college or university|university or college)$/, ['university']],
    [/^(?:degree|highest degree attained|education level)$/, ['degree']],
    [/^(?:graduation date|graduation year|year of graduation)$/, ['graduationDate']],
    [/^(?:skills|technical skills|programming languages)$/, ['skills']],
    [/^(?:current company|current employer)$/, ['currentCompany']],
    [/^(?:current title|current job title)$/, ['currentTitle']],
    [/^(?:location|current location|city and state)$/, ['location']],
    [/^city$/, ['city']],
    [/^(?:country|country of residence)$/, ['country']],
    [/^(?:state|province|state \/ province)$/, ['state']],
    [/^(?:zip|zip code|postal code)$/, ['postalCode']],
    [/^(?:street address|address line 1)$/, ['address']],
    [/^address line 2$/, ['addressLine2']],
  ];
  const matched = keys.find(([pattern]) => pattern.test(question));
  if (matched) return matched[1];
  // A textarea asking for a URL is still a fact, not a writing assignment.
  if (/^(?:please (?:provide|enter|share) |your )?(?:linkedin|github)(?: profile)?(?: url| link)?$/.test(question)) {
    return [question.includes('linkedin') ? 'linkedin' : 'github'];
  }
  if (/^(?:website|website url|personal website|portfolio|portfolio url|portfolio link|portfolio or website|personal site)$/.test(question)) return ['portfolio'];
  if (fieldType === 'email') return ['email'];
  if (fieldType === 'url') return null;
  return null;
}

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

  // Most real forms split the name. First and last word of the stored name
  // are still copied, not invented.
  const name = (profile as UserProfile).name;
  if (typeof name === "string") {
    const parts = name.trim().split(/\s+/);
    if (parts.length > 1) flat.push(parts[0], parts[parts.length - 1]);
  }

  return new Set(flat.filter(Boolean).map(normalize));
}

/** A question asking where the applicant is, as opposed to anything else. */
const ASKS_FOR_PLACE = /\b(city|town|current location|where are you based|where do you live|where are you located)\b/i;

/**
 * "Atlanta, GA" and "Atlanta, Georgia, United States" name the same place as
 * a profile's "Atlanta, Georgia": the city has to match, and the rest may be
 * written the way the site's own place list writes it.
 */
const US_REGIONS: Record<string, string> = Object.fromEntries(
  "AL:Alabama|AK:Alaska|AZ:Arizona|AR:Arkansas|CA:California|CO:Colorado|CT:Connecticut|DE:Delaware|FL:Florida|GA:Georgia|HI:Hawaii|ID:Idaho|IL:Illinois|IN:Indiana|IA:Iowa|KS:Kansas|KY:Kentucky|LA:Louisiana|ME:Maine|MD:Maryland|MA:Massachusetts|MI:Michigan|MN:Minnesota|MS:Mississippi|MO:Missouri|MT:Montana|NE:Nebraska|NV:Nevada|NH:New Hampshire|NJ:New Jersey|NM:New Mexico|NY:New York|NC:North Carolina|ND:North Dakota|OH:Ohio|OK:Oklahoma|OR:Oregon|PA:Pennsylvania|RI:Rhode Island|SC:South Carolina|SD:South Dakota|TN:Tennessee|TX:Texas|UT:Utah|VT:Vermont|VA:Virginia|WA:Washington|WV:West Virginia|WI:Wisconsin|WY:Wyoming|DC:District of Columbia"
    .toLowerCase().split("|").map(pair => pair.split(":")),
);

function samePlace(value: string, location: string | undefined): boolean {
  if (!location) return false;
  const parts = (s: string) => s.split(",").map(part => {
    const p = normalize(part).replace(/\./g, "");
    if (/^(us|usa|united states of america)$/.test(p)) return "united states";
    return US_REGIONS[p] || p;
  });
  const proposed = parts(value), known = parts(location);
  if (!proposed[0] || proposed[0] !== known[0]) return false;
  // A city-only field may omit the known region. It may never change it.
  return proposed.slice(1).every(p => known.slice(1).includes(p) ||
    (p === "united states" && known.slice(1).some(k => Object.values(US_REGIONS).includes(k))));
}

/**
 * `fieldType` follows the in-app vocabulary: "textarea" is free text and is
 * always allowed; "tags" is a comma-separated list checked token by token.
 * `label`, when given, lets a location question take the profile's city in
 * the site's own spelling.
 */
export function isGroundedValue(
  fieldType: string,
  value: string,
  profile: ProfileLike,
  label = "",
): boolean {
  const keys = factKeysFor(label, fieldType);
  if (fieldType === "textarea" && !keys) return true; // prose also requires semantic review in /api/agent

  if (keys) {
    const source = profile as Record<string, string | string[] | undefined>;
    const scoped: Record<string, string | string[] | undefined> = {};
    for (const key of keys) {
      if (key === 'city' && typeof source.city !== 'string' && typeof source.location === 'string') {
        scoped.city = source.location.split(',')[0].trim();
      } else {
        scoped[key] = source[key];
      }
    }
    if (keys.includes('firstName') || keys.includes('lastName')) {
      const parts = typeof source.name === 'string' ? source.name.trim().split(/\s+/) : [];
      if (parts.length > 1) scoped.name = keys.includes('firstName') ? parts[0] : parts[parts.length - 1];
    }
    if (keys.includes('degree') && source.degree && source.minor) {
      scoped.degreeComposite = `${source.degree}, minor in ${source.minor}`;
      scoped.degreeWithMinor = `${source.degree} (minor: ${source.minor})`;
    }
    if (keys.includes('location') && typeof source.location === 'string' && samePlace(value, source.location)) return true;
    const known = knownValues(scoped);
    const v = normalize(value).replace(/\/+$/, '');
    if ([...known].some(item => item.replace(/\/+$/, '') === v)) return true;
    const tokens = value.split(/[,;]\s*/).map(token => token.trim()).filter(Boolean);
    return keys.includes('skills') && tokens.length > 0 && tokens.every(token => known.has(normalize(token)));
  }

  const location = (profile as UserProfile).location;
  if (ASKS_FOR_PLACE.test(label) && typeof location === "string" && samePlace(value, location)) {
    return true;
  }

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
