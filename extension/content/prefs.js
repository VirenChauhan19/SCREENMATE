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
    const stored = prefs?.[field.topic];
    if (!stored || stored === ASK) return null;

    const needsOption = field.type === "select" && field.options?.length;
    const value = needsOption ? matchOption(stored, field.options) : stored;
    if (!value) return null;
    return { value, topic: field.topic, stored };
  }

  /** An unambiguous profile value or explicit degree level for a factual dropdown. */
  function profileOption(field, profile) {
    if (field?.type !== 'select' || field.sensitive || !field.options?.length) return null;
    const label = field.label || '';
    // The user requested Mobile as the default for their phone's device type.
    // Restrict this to phone questions; unrelated device questions need facts.
    if (/\b(phone|telephone|contact|mobile)\b/i.test(label) && /\b(type|device|kind)\b/i.test(label)) {
      const choices = field.options.filter(option => /^(mobile(?: phone)?|cell(?:ular)?(?: phone)?)$/i.test(option.trim()));
      return choices.length === 1 ? choices[0] : null;
    }
    if (/^device\s+type\b/i.test(label) && field.options.some(option => /^(home|work|landline)(?: phone)?$/i.test(option.trim()))) {
      const choices = field.options.filter(option => /^(mobile(?: phone)?|cell(?:ular)?(?: phone)?)$/i.test(option.trim()));
      return choices.length === 1 ? choices[0] : null;
    }
    const mappings = [
      [/degree|education|qualification/i, ['degree']],
      [/university|college|school|institution/i, ['university', 'school']],
      [/location|city|country|state|province/i, ['location', 'city', 'country', 'state', 'province']],
      [/graduat/i, ['graduationDate']],
      [/skill/i, ['skills']],
    ];
    const keys = mappings.find(([pattern]) => pattern.test(label))?.[1] || [];
    const values = keys.flatMap(key => Array.isArray(profile?.[key]) ? profile[key] : [profile?.[key]])
      .filter(value => typeof value === 'string' && value.trim());
    const matches = field.options.filter(option => values.some(value => norm(value) === norm(option)));
    if (matches.length) return matches.length === 1 ? matches[0] : null;
    // Degree level is explicit in these qualifications; match the portal's
    // category without making the model invent a different qualification.
    if (/degree|education|qualification/i.test(label) && typeof profile?.degree === 'string') {
      const levels = [
        [/\b(bachelor|baccalaureate|bfa|bsc|b\.sc|b\.a|b\.s|ba|bs|beng|btech)\b/i, /bachelor|baccalaureate/i],
        [/\b(master|mfa|msc|m\.sc|m\.a|m\.s|ma|ms|mba|meng|mtech)\b/i, /master|postgraduate degree/i],
        [/\b(phd|ph\.d|doctorate|doctoral)\b/i, /doctor|ph\.?d/i],
        [/\b(associate|aas|a\.a|a\.s)\b/i, /associate/i],
      ];
      const sourceLevels = levels.filter(([source]) => source.test(profile.degree));
      if (sourceLevels.length !== 1) return null;
      const choices = field.options.filter(option => sourceLevels[0][1].test(option));
      return choices.length === 1 ? choices[0] : null;
    }
    return null;
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
    profileOption,
    matchOption,
    load,
    save,
    setOne,
    isComplete,
    unanswered,
  };
})();
