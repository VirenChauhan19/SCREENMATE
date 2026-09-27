/**
 * Standing answers.
 *
 * Every application asks the same dozen questions. Pausing the run to ask you
 * each time, on every site, is worse than asking once — so you answer them up
 * front and the agent transcribes your answer.
 *
 * The safety property is unchanged and worth being precise about: the agent
 * still never *decides* a sensitive question. It fills in a decision you already
 * made, and says so. Anything you left as "Ask me each time" still stops the run.
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

  // A bare "y"/"n" only as the whole option, so "N/A" is never a no.
  const YES = /^(yes|true|i am|i do|i will|i have)\b|^y$/i;
  // "No preference" is not a no.
  const NO =
    /^(no(?! preference)|false|i am not|i'?m not|i do not|i don'?t|i will not|i won'?t|i have not|i haven'?t)\b|^n$/i;
  // Covers the official wordings: CC-305's "I do not want to answer",
  // Greenhouse's "I don't wish to answer", "Decline To Self Identify".
  const DECLINE =
    /(do not|don'?t) (wish|want)|prefer not|decline|choose not|rather not|not to (say|answer|disclose)/i;

  const norm = (s) =>
    String(s || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

  // Cosmetic portal differences must not turn a known question into a new one.
  const questionText = s => norm(s).replace(/[’‘]/g, "'")
    .replace(/\s+select one(?:\s+required)?$/i, "")
    .replace(/\s*\((?:required|optional)\)\s*$/i, "")
    .replace(/[?*:.\s]+$/g, "").trim();

  function questionKey(label) {
    const text = questionText(label);
    // Country stays part of the key: permission to work in one country says
    // nothing about another. Only equivalent, affirmative questions merge.
    const authorization = text.match(/^are you (?:legally )?(?:authori[sz]ed|eligible|entitled) to work in (?:the )?(.+)$/);
    const country = authorization?.[1].replace(/\./g, "");
    const countries = {
      us: 'united states', usa: 'united states', 'united states': 'united states',
      'united states of america': 'united states',
      uk: 'united kingdom', 'united kingdom': 'united kingdom',
      canada: 'canada', australia: 'australia', india: 'india',
    };
    return country && countries[country] ? `work authorization in ${countries[country]}` : text;
  }

  function keyFor(field) {
    return canReuseTopic(field) ? field.topic : `label:${questionKey(field.label)}`;
  }

  function storedFor(field, prefs, key = keyFor(field)) {
    // Retain answers saved by older versions, including their punctuation.
    if (Object.prototype.hasOwnProperty.call(prefs || {}, key)) return prefs[key];
    const matches = Object.entries(prefs || {}).filter(([k]) => {
      if (!k.startsWith("label:")) return false;
      const label = questionText(k.slice(6));
      return key.startsWith("label:")
        ? questionKey(label) === key.slice(6)
        : canReuseTopic({ ...field, label }, key);
    });
    const values = [...new Set(matches.map(([, v]) => v))];
    return values.length === 1 ? values[0] : undefined;
  }

  function shouldAsk(field, prefs) {
    return Boolean(field.required) || storedFor(field, prefs) === ASK;
  }

  /** "no" starts "No, I will not…" but not "None" or "Not applicable". */
  const startsAtWord = (text, prefix) =>
    Boolean(prefix) && text.startsWith(prefix) && !/[a-z0-9]/.test(text.charAt(prefix.length));

  /** Whole-word containment: "male" is in "I am male", not in "Female". */
  const hasWord = (text, word) => {
    const at = text.indexOf(word);
    if (!word || at === -1) return false;
    for (let i = at; i !== -1; i = text.indexOf(word, i + 1)) {
      const before = text.charAt(i - 1);
      const after = text.charAt(i + word.length);
      if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
    }
    return false;
  };

  /**
   * Maps a stored answer onto whatever wording this particular site uses.
   * "No" has to match "No, I do not require sponsorship"; "I do not wish to
   * answer" has to match "Decline to self-identify".
   *
   * These values land in protected fields, so a wrong match is worse than
   * none: every branch that recognises the shape of the answer returns rather
   * than falling through. That fallthrough is how "I do not wish to answer"
   * once became "Yes, I have a disability".
   */
  function matchOption(answer, options) {
    if (!options || options.length === 0) return answer;
    const a = norm(answer);
    if (!a) return null;

    const exact = options.find((o) => norm(o) === a);
    if (exact) return exact;

    // Short options ("No", "Yes") are left to the yes/no branches, so that
    // "No preference" cannot prefix-match "No".
    const unique = predicate => {
      const matches = options.filter(predicate);
      return matches.length === 1 ? matches[0] : null;
    };
    if (DECLINE.test(a)) return unique(o => DECLINE.test(o));
    // Negative before positive: "I am not a protected veteran" also starts
    // with "I am".
    if (NO.test(a)) return unique(o => NO.test(o) && !DECLINE.test(o));
    if (YES.test(a)) {
      return unique(o => YES.test(o) && !NO.test(o) && !DECLINE.test(o));
    }

    const matches = options.filter(
        (o) =>
          !DECLINE.test(o) && (hasWord(norm(o), a) || (a.length > 3 && norm(o).length > 3 && hasWord(a, norm(o))))
    );
    return matches.length === 1 ? matches[0] : null;
  }

  // Topic alone does not preserve a question's polarity or scope. Unknown
  // wordings get a fresh answer, remembered under the full question instead.
  function canReuseTopic(field, key = field?.topic) {
    if (!key || field?.type === "textarea") return false;
    const tidy = questionText;
    const label = tidy(field.label);
    const canonical = QUESTIONS.find(q => q.topic === key);
    if (canonical && label === tidy(canonical.label)) return true;
    const equivalents = {
      sponsorship: /^(?:will|do) you (?:now or in the future |now or at any time in the future )?(?:require|need) (?:visa |employment |employer )?sponsorship(?: (?:now or in the future|now or at any time in the future|to work))?$/,
      relocation: /^are you willing to relocate$/,
      gender: /^(?:gender|gender identity|what is your gender)$/,
      ethnicity: /^(?:race\s*\/\s*ethnicity|race and ethnicity|race|ethnicity)$/,
      veteran: /^(?:protected veteran status)$/,
      disability: /^(?:disability status|do you have a disability)$/,
      remotePreference: /^(?:preferred work arrangement|work location preference)$/,
      salary: /^(?:(?:desired|expected) (?:salary|compensation)|(?:salary|compensation) expectations|what (?:is|are) your (?:desired salary|salary expectations))$/,
      startDate: /^(?:earliest start date|available start date|start date|when are you available to start|when can you start)$/,
      noticePeriod: /^(?:notice period|what is your notice period)$/,
    };
    return Boolean(equivalents[key]?.test(label));
  }

  /**
   * Resolves a field to a concrete value from stored preferences.
   * Returns null when there is no standing answer — the run then stops and asks.
   */
  function resolve(field, prefs, key = field?.topic) {
    if (!key) return null;
    // A standing answer is a short decision, never an essay. A free-text
    // question that merely mentions a topic word ("a race condition you
    // debugged", "your remote work experience") is not asking for it.
    if (field.type === "textarea") return null;
    if (!key.startsWith("label:") && !canReuseTopic(field, key)) return null;
    const stored = storedFor(field, prefs, key);
    if (!stored || stored === ASK) return null;

    const needsOption = field.type === "select" && field.options?.length;
    const value = needsOption ? matchOption(stored, field.options) : stored;
    if (!value) return null;
    return { value, topic: key, stored };
  }

  async function load() {
    const { preferences } = await chrome.storage.local.get("preferences");
    return preferences || {};
  }

  async function save(preferences) {
    await chrome.storage.local.set({ preferences });
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
    return setMany({ [topic]: value });
  }

  function setMany(values, { complete = false } = {}) {
    const update = async () => {
      const prefs = await load();
      Object.assign(prefs, values);
      if (complete) for (const q of QUESTIONS) prefs[q.topic] ||= ASK;
      await save(prefs);
      return prefs;
    };
    writeQueue = writeQueue.then(update, update);
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
    canReuseTopic,
    keyFor,
    storedFor,
    shouldAsk,
    matchOption,
    load,
    save,
    setOne,
    setMany,
    isComplete,
    unanswered,
  };
})();
