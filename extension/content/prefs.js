/**
 * Standing answers.
 *
 * Every application asks the same dozen questions. Pausing the run to ask you
 * each time, on every site, is worse than asking once — so you answer them up
 * front and the agent transcribes your answer.
 *
 * The safety property is unchanged and worth being precise about: the agent
 * still never *decides* a sensitive question. It fills in a decision you already
 * made, and says so. Unanswered dropdowns stay for final review.
 */

(() => {
  const ASK = "__ask__";

  /** The questions worth having a standing answer for. */
  const QUESTIONS = [
    {
      topic: "workAuthorization",
      label: "Are you legally authorized to work in this country?",
      options: ["Yes", "No"],
    },
    {
      topic: "sponsorship",
      label: "Will you now or in the future require visa sponsorship?",
      options: ["Yes", "No"],
    },
    {
      topic: "relocation",
      label: "Are you willing to relocate?",
      options: ["Yes", "No"],
    },
    {
      topic: "remotePreference",
      label: "Preferred work arrangement",
      options: ["Remote", "Hybrid", "On-site", "No preference"],
    },
    {
      topic: "salary",
      label: "Desired salary",
      free: true,
      placeholder: "e.g. 120000, or “Negotiable”",
    },
    {
      topic: "startDate",
      label: "Earliest start date",
      free: true,
      placeholder: "e.g. June 2026, or “Immediately”",
    },
    {
      topic: "gender",
      label: "Gender",
      options: ["Male", "Female", "Non-binary", "I do not wish to answer"],
      protectedTopic: true,
    },
    {
      topic: "ethnicity",
      label: "Race / ethnicity",
      options: [
        "Asian",
        "Black or African American",
        "Hispanic or Latino",
        "White",
        "Two or more races",
        "I do not wish to answer",
      ],
      protectedTopic: true,
    },
    {
      topic: "veteran",
      label: "Protected veteran status",
      options: [
        "I am a protected veteran",
        "I am not a protected veteran",
        "I do not wish to answer",
      ],
      protectedTopic: true,
    },
    {
      topic: "disability",
      label: "Disability status",
      options: [
        "Yes, I have a disability",
        "No, I do not have a disability",
        "I do not wish to answer",
      ],
      protectedTopic: true,
    },
  ];

  const YES = /^(yes|y|true|i am|i do)\b/i;
  const NO = /^(no|n|false|i am not|i do not|i don'?t)\b/i;
  const DECLINE = /(do not wish|prefer not|decline|choose not)/i;

  const norm = (s) =>
    String(s || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

  /**
   * Maps a stored answer onto whatever wording this particular site uses.
   * "No" has to match "No, I do not require sponsorship"; "I do not wish to
   * answer" has to match "Decline to self-identify".
   */
  function matchOption(answer, options) {
    if (!options || options.length === 0) return answer;
    const a = norm(answer);

    const exact = options.find((o) => norm(o) === a);
    if (exact) return exact;

    const unique = candidates => candidates.length === 1 ? candidates[0] : null;
    if (DECLINE.test(answer)) {
      return unique(options.filter((o) => DECLINE.test(o)));
    }
    if (YES.test(answer) && !NO.test(answer)) {
      return unique(options.filter((o) => YES.test(o) && !NO.test(o)));
    }
    if (NO.test(answer)) {
      return unique(options.filter((o) => NO.test(o)));
    }
    return null;
  }

  /**
   * Resolves a field to a concrete value from stored preferences.
   * Returns null when there is no saved answer; dropdowns stay for final review.
   */
  function resolve(field, prefs) {
    if (!field?.topic) return null;
    if (!canReuseAnswer(field)) return null;
    const stored = prefs?.[field.topic];
    if (!stored || stored === ASK) return null;

    const needsOption = field.type === "select" && field.options?.length;
    const value = needsOption ? matchOption(stored, field.options) : stored;
    if (!value) return null;
    return { value, topic: field.topic, stored };
  }

  // A topic match is not enough: "need sponsorship" and "work without
  // sponsorship" require opposite answers. Ambiguous declarations stay manual.
  function canReuseAnswer(field) {
    const label = norm(field?.label);
    if (!label || /\b(not|without|never|unable|unwilling|unless|except|citizen|citizenship|permanent resident)\b/.test(label)) return false;
    if (field.topic === "sponsorship") {
      return /\b(need|require)\b.*\bsponsor/.test(label) && !/\b(authori[sz]ed|eligible|right to work)\b/.test(label);
    }
    if (field.topic === "workAuthorization") {
      return /authori[sz]ed to work|work authori[sz]ation|eligible to work|right to work/.test(label) && !/sponsor|visa/.test(label);
    }
    if (field.topic === "relocation") return /willing to relocate|able to relocate|open to relocat/.test(label);
    // Salary currency/period, availability and legal declarations vary by job.
    if (["salary", "startDate", "noticePeriod", "criminalHistory"].includes(field.topic)) return false;
    return true;
  }

  const fold = value => norm(value).normalize('NFKC').replace(/[’‘]/g, "'");
  const aliasKey = value => fold(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[.']/g, '').replace(/\s+/g, ' ').trim();
  const COUNTRIES = [
    ['US', 'United States', 'USA', 'United States of America', 'U.S.', 'U.S.A.'],
    ['GB', 'United Kingdom', 'UK', 'GBR', 'Great Britain', 'U.K.'],
    ['CA', 'Canada', 'CAN'], ['AU', 'Australia', 'AUS'], ['IN', 'India', 'IND'],
    ['DE', 'Germany', 'DEU'], ['FR', 'France', 'FRA'], ['IE', 'Ireland', 'IRL'],
    ['NL', 'Netherlands', 'NLD'], ['NZ', 'New Zealand', 'NZL'],
    ['AE', 'United Arab Emirates', 'UAE', 'ARE'],
  ];
  const REGIONS = {
    US: 'AL:Alabama|AK:Alaska|AZ:Arizona|AR:Arkansas|CA:California|CO:Colorado|CT:Connecticut|DE:Delaware|DC:District of Columbia|FL:Florida|GA:Georgia|HI:Hawaii|ID:Idaho|IL:Illinois|IN:Indiana|IA:Iowa|KS:Kansas|KY:Kentucky|LA:Louisiana|ME:Maine|MD:Maryland|MA:Massachusetts|MI:Michigan|MN:Minnesota|MS:Mississippi|MO:Missouri|MT:Montana|NE:Nebraska|NV:Nevada|NH:New Hampshire|NJ:New Jersey|NM:New Mexico|NY:New York|NC:North Carolina|ND:North Dakota|OH:Ohio|OK:Oklahoma|OR:Oregon|PA:Pennsylvania|RI:Rhode Island|SC:South Carolina|SD:South Dakota|TN:Tennessee|TX:Texas|UT:Utah|VT:Vermont|VA:Virginia|WA:Washington|WV:West Virginia|WI:Wisconsin|WY:Wyoming',
    CA: 'AB:Alberta|BC:British Columbia|MB:Manitoba|NB:New Brunswick|NL:Newfoundland and Labrador|NS:Nova Scotia|NT:Northwest Territories|NU:Nunavut|ON:Ontario|PE:Prince Edward Island|QC:Quebec|SK:Saskatchewan|YT:Yukon',
  };
  const AUTOCOMPLETE = {
    name: 'name', 'given-name': 'firstName', 'family-name': 'lastName', email: 'email',
    tel: 'phone', 'street-address': 'addressLine1',
    'address-line1': 'addressLine1', 'address-line2': 'addressLine2',
    'address-level1': 'state', 'address-level2': 'city', 'postal-code': 'postalCode',
    country: 'country', 'country-name': 'country', url: 'portfolio',
  };
  const SOURCE_KEYS = {
    name: ['name', 'fullName'], firstName: ['firstName'], lastName: ['lastName'],
    email: ['email'], phone: ['phone'], location: ['location'], country: ['country'],
    state: ['state', 'province'], city: ['city'], postalCode: ['postalCode'],
    addressLine1: ['addressLine1'], addressLine2: ['addressLine2'],
    school: ['university', 'school'], degree: ['degree'], fieldOfStudy: ['fieldOfStudy'],
    minor: ['minor'], graduationDate: ['graduationDate'], graduationYear: ['graduationDate'],
    portfolio: ['portfolio'], linkedin: ['linkedin'], github: ['github'], skills: ['skills'],
    phoneType: ['phoneType'],
  };
  function countryGroup(value) {
    const key = aliasKey(value);
    const direct = COUNTRIES.find(group => group.some(item => aliasKey(item) === key));
    if (direct) return direct;
    const parts = String(value || '').match(/^(.+?)\s*\(([^)]+)\)$/);
    if (!parts) return null;
    const left = COUNTRIES.find(group => group.some(item => aliasKey(item) === aliasKey(parts[1])));
    const right = COUNTRIES.find(group => group.some(item => aliasKey(item) === aliasKey(parts[2])));
    return left && left === right ? left : null;
  }
  function contextAllowed(field) {
    const context = [field?.label, field?.context, field?.groupLabel, field?.sectionLabel, field?.section].filter(value => typeof value === 'string').join(' ');
    return !/\b(references?|referees?|recommenders?|supervisors?|managers?|emergency|previous|former|past|history|employers?|employment history|work experience|company|citizenship|nationality|birth|salary|sponsor|visa|consent)\b/i.test(context);
  }
  function emptyFactualField(field) {
    return Boolean(field && !String(field.value || '').trim() &&
      ['text', 'email', 'url', 'tel', 'select', 'tags'].includes(field.type) && contextAllowed(field));
  }
  function labelKind(field) {
    const label = fold(field.label).replace(/[*:]/g, '').trim();
    if (/\b(middle name|preferred name|nickname|phone extension|dialling code|dialing code|country code|high school|years of education|education duration)\b/.test(label)) return null;
    const rules = [
      [/\bfirst\s*(?:and|&|\/)\s*last\s+name\b/, 'name'],
      [/\b(?:first|given)\s+name\b/, 'firstName'], [/\b(?:last|family)\s+name\b|\bsurname\b/, 'lastName'],
      [/\b(?:full|legal|complete)\s+(?:legal\s+)?name\b|^(?:your |applicant )?name$/, 'name'],
      [/\be-?mail\b/, 'email'],
      [/\b(?:phone|telephone|contact|mobile)\b.*\b(?:type|device|kind)\b/, 'phoneType'],
      [/\b(phone|telephone|mobile|cellphone)\b/, 'phone'],
      [/\b(address\s*(?:line\s*)?2|apartment|suite|unit number)\b/, 'addressLine2'],
      [/\b(address\s*(?:line\s*)?1|street address|street and number)\b|^(?:home |mailing )?address$/, 'addressLine1'],
      [/\b(postal|zip|postcode)\b/, 'postalCode'], [/\bcountry\b/, 'country'],
      [/\bcity\s*(?:and|,|\/)\s*(?:state|province|region)\b/, 'location'],
      [/\b(state|province|region)\b/, 'state'], [/\b(city|town)\b/, 'city'],
      [/\b(?:current |home |residential )?location\b/, 'location'],
      [/\b(field of study|major|discipline|speciali[sz]ation|course of study)\b/, 'fieldOfStudy'],
      [/\bminor\b/, 'minor'],
      [/graduat.*year|year.*graduat|completion year|year of completion/, 'graduationYear'],
      [/graduat.*date|date.*graduat|^graduation$/, 'graduationDate'],
      [/\b(degree|qualification|education level|level of education)\b/, 'degree'],
      [/\b(university|college|school|institution)\b/, 'school'],
      [/\blinked\s?in\b/, 'linkedin'], [/\bgithub\b/, 'github'],
      [/\b(portfolio|personal website)\b|^website(?: url)?$/, 'portfolio'], [/\bskills?\b/, 'skills'],
    ];
    const kind = rules.find(([pattern]) => pattern.test(label))?.[1];
    if (kind === 'phone' && /\b(fax|home|work|office|extension|country|code)\b/.test(label)) return null;
    if (kind) return kind;
    if (/^device\s+type\b/.test(label) && field.options?.some(option => /^(home|work|landline)(?: phone)?$/i.test(option.trim()))) return 'phoneType';
    return null;
  }
  function fieldKind(field) {
    const label = fold(field.label);
    if (/\b(middle|preferred|nickname|extension|fax|birth|citizen|nationality|country code|high school|years of education|education duration)\b/.test(label)) return null;
    const explicit = labelKind(field);
    const metadata = String(field.autocomplete || field.autoComplete || '').toLowerCase().split(/\s+/).map(token => AUTOCOMPLETE[token]).filter(Boolean);
    const unique = [...new Set(metadata)];
    if (unique.length > 1 || (explicit && unique.length && explicit !== unique[0])) return null;
    return explicit || unique[0] || null;
  }
  function dateValue(field, value, kind) {
    if (kind === 'graduationYear') {
      const years = value.match(/\b(?:19|20)\d{2}\b/g) || [];
      return years.length === 1 ? years[0] : null;
    }
    const inputType = field.inputType || field.el?.type;
    if (inputType === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
      const date = new Date(`${value}T00:00:00Z`);
      return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
    }
    if (inputType === 'month') return /^\d{4}-(?:0[1-9]|1[0-2])(?:-\d{2})?$/.test(value) ? value.slice(0, 7) : null;
    return value;
  }
  /** Candidate values always retain their source; no name/location splitting. */
  function profileCandidates(field, profile = {}) {
    if (!emptyFactualField(field) || field.sensitive || field.level === 'sensitive') return [];
    const kind = fieldKind(field);
    if (!kind) return [];
    const candidates = (SOURCE_KEYS[kind] || []).flatMap(sourceKey => {
      const values = Array.isArray(profile[sourceKey]) ? profile[sourceKey] : [profile[sourceKey]];
      return values.filter(value => typeof value === 'string' && value.trim()).map(value => {
        const trimmed = value.trim();
        return { value: kind.startsWith('graduation') ? dateValue(field, trimmed, kind) : trimmed, sourceKey, kind };
      }).filter(candidate => candidate.value);
    });
    // Existing user-selected default for phone categories, never computer types.
    if (kind === 'phoneType' && !candidates.length) candidates.push({ value: 'Mobile', sourceKey: 'phoneType', kind });
    return candidates;
  }
  function stateKey(value, profile) {
    const country = countryGroup(profile.country)?.[0];
    if (!REGIONS[country]) return null;
    const region = REGIONS[country].split('|').map(item => item.split(':'))
      .find(pair => pair.some(item => aliasKey(item) === aliasKey(value)));
    return region ? `${country}:${region[0]}` : null;
  }
  function degreeLevels(value) {
    const normalized = aliasKey(value);
    const levels = [
      ['bachelor', /\b(bachelor|bachelors|baccalaureate|bfa|bsc|ba|bs|beng|btech)\b/],
      ['master', /\b(master|masters|mfa|msc|ma|ms|mba|meng|mtech)\b/],
      ['doctorate', /\b(phd|doctorate|doctoral)\b/], ['associate', /\b(associate|associates|aas|aa|as)\b/],
    ].filter(([, pattern]) => pattern.test(normalized));
    return levels.map(([level]) => level);
  }
  function degreeLevel(value) {
    const levels = degreeLevels(value);
    return levels.length === 1 ? levels[0] : null;
  }
  function optionDegreeLevel(value) {
    const normalized = aliasKey(value).replace(/\s*\((?:ba|bs|bsc|bfa|ma|ms|msc|mfa|phd|aa|as|aas)\)$/, '');
    if (/^(bachelor|bachelors|baccalaureate)( degree)?$/.test(normalized)) return 'bachelor';
    if (/^(master|masters)( degree)?$/.test(normalized)) return 'master';
    if (/^(doctorate|doctoral(?: degree)?|phd)$/.test(normalized)) return 'doctorate';
    if (/^(associate|associates)( degree)?$/.test(normalized)) return 'associate';
    return null;
  }
  function matchesAlias(candidate, option, profile) {
    if (candidate.kind === 'country') return Boolean(countryGroup(candidate.value) && countryGroup(candidate.value) === countryGroup(option));
    if (candidate.kind === 'state') return Boolean(stateKey(candidate.value, profile) && stateKey(candidate.value, profile) === stateKey(option, profile));
    if (candidate.kind === 'phoneType') return /^(mobile(?: phone)?|cell(?:ular)?(?: phone)?)$/.test(fold(candidate.value)) && /^(mobile(?: phone)?|cell(?:ular)?(?: phone)?)$/.test(fold(option));
    if (candidate.kind === 'degree') return Boolean(degreeLevel(candidate.value) && degreeLevel(candidate.value) === optionDegreeLevel(option));
    if (candidate.kind === 'school') {
      const parts = option.match(/^(.+?)\s*\(([A-Za-z][A-Za-z. &-]{1,15})\)$/);
      return Boolean(parts && (fold(candidate.value) === fold(parts[1]) || aliasKey(candidate.value) === aliasKey(parts[2])));
    }
    return false;
  }
  /** Resolve a known fact to a unique live choice, or copy a single stored fact. */
  function resolveProfile(field, profile = {}) {
    const candidates = profileCandidates(field, profile);
    if (!candidates.length) return null;
    if (field.type !== 'select') {
      const values = [...new Set(candidates.map(candidate => candidate.value))];
      if (values.length > 1 && candidates[0].kind !== 'skills') return null;
      if (candidates[0].kind === 'phoneType') return null;
      return { value: values.join(', '), sourceKey: candidates[0].sourceKey, reason: `Copied from your saved ${candidates[0].sourceKey}.` };
    }
    const options = field.options?.filter(option => typeof option === 'string' && option.trim()) || [];
    const match = predicate => options.map(value => ({ value, candidate: candidates.find(candidate => predicate(candidate, value)) })).filter(hit => hit.candidate);
    const exact = match((candidate, option) => fold(candidate.value) === fold(option));
    // Phone categories deliberately keep the old ambiguity rule: Mobile and
    // Cellular together require a choice, even when one is an exact spelling.
    const hits = candidates[0].kind === 'phoneType' ? match((candidate, option) => fold(candidate.value) === fold(option) || matchesAlias(candidate, option, profile)) :
      exact.length ? exact : match((candidate, option) => matchesAlias(candidate, option, profile));
    if (hits.length !== 1) return null;
    const { value, candidate } = hits[0];
    return { value, sourceKey: candidate.sourceKey, reason: `Matched to your saved ${candidate.sourceKey}.` };
  }
  function profileOption(field, profile) {
    return field?.type === 'select' ? resolveProfile(field, profile)?.value || null : null;
  }
  /** A query reveals real choices; it is never itself treated as a selection. */
  function queryFor(field, profile, prefs) {
    if (!field || String(field.value || '').trim() || field.type !== 'select') return null;
    if (field.topic && canReuseAnswer(field)) {
      const answer = prefs?.[field.topic];
      if (typeof answer === 'string' && answer && answer !== ASK) return answer;
    }
    const candidates = profileCandidates(field, profile);
    const values = [...new Set(candidates.map(candidate => candidate.value))];
    if (values.length !== 1) return null;
    const kind = candidates[0].kind;
    if (kind === 'country') return countryGroup(values[0])?.[1] || values[0];
    if (kind === 'state') {
      const key = stateKey(values[0], profile);
      if (key) {
        const [country, code] = key.split(':');
        return REGIONS[country].split('|').map(item => item.split(':'))
          .find(([abbreviation]) => abbreviation === code)[1];
      }
    }
    // A generic degree-level menu may search "Bachelor" but not "BFA".
    // This is only a search hint: resolveProfile must still verify a unique
    // exact qualification or supported level among the returned options.
    if (kind === 'degree' && /\b(highest|level)\b/.test(fold(field.label))) {
      const levels = degreeLevels(values[0]);
      if (levels.length > 1) return null;
      if (levels.length === 1) return { bachelor: 'Bachelor', master: 'Master', doctorate: 'Doctorate', associate: 'Associate' }[levels[0]];
    }
    return values[0];
  }

  async function load() {
    const { preferences } = await new Promise((r) =>
      chrome.storage.local.get("preferences", r),
    );
    return preferences || {};
  }

  async function save(preferences) {
    await new Promise((r) => chrome.storage.local.set({ preferences }, r));
  }

  /**
   * Serialised so rapid clicks can't clobber each other.
   *
   * Preferences live in one storage object, so a naive read-modify-write loses
   * updates when several land at once — which is exactly what happens when
   * someone answers the setup card quickly. Each write waits its turn.
   */
  let writeQueue = Promise.resolve();

  function setOne(topic, value) {
    writeQueue = writeQueue.then(async () => {
      const prefs = await load();
      prefs[topic] = value;
      await save(prefs);
      return prefs;
    });
    return writeQueue;
  }

  /** True once the user has made a choice about every question. */
  function isComplete(prefs) {
    return QUESTIONS.every((q) => prefs?.[q.topic]);
  }

  function unanswered(prefs) {
    return QUESTIONS.filter((q) => !prefs?.[q.topic]);
  }

  window.__screenmatePrefs = {
    ASK,
    QUESTIONS,
    resolve,
    canReuseAnswer,
    profileOption,
    profileCandidates,
    resolveProfile,
    queryFor,
    matchOption,
    load,
    save,
    setOne,
    isComplete,
    unanswered,
  };
})();
