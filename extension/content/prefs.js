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

  /**
   * A decline, however the site words it: "I don't wish to answer", "I do not
   * want to answer", "Decline to self-identify". "No, I do not want to
   * relocate" is an answer, not a decline.
   */
  const DECLINE =
    /\bdecline|\b(do not|don['’]?t|prefer not|choose not|rather not)\b.*\b(answer|disclose|say|identify|provide|share|respond)\b/i;

  const norm = (s) =>
    String(s || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

  /** True when `option` begins with the words of `lead`: "No" leads "No, I…", not "None". */
  function leads(option, lead) {
    const o = norm(option);
    const l = norm(lead);
    return o.startsWith(l) && !/[\p{L}\p{N}]/u.test(o.charAt(l.length));
  }

  /**
   * Maps a stored answer onto whatever wording this particular site uses.
   * "No" has to match "No, I do not require sponsorship"; "I do not wish to
   * answer" has to match "Decline to self-identify".
   *
   * Returns null rather than guess, and the question goes to the user. These
   * are protected questions: looser matching once turned "I do not wish to
   * answer" into "Yes, I have a disability", and "Hispanic or Latino" into
   * "No" because "Latino" contains "no".
   */
  function matchOption(answer, options) {
    if (!options || options.length === 0) return answer;
    const a = norm(answer);

    const exact = options.find((o) => norm(o) === a);
    if (exact) return exact;

    // A decline maps onto a decline and nothing else.
    if (DECLINE.test(answer)) return options.find((o) => DECLINE.test(o)) || null;
    const answers = options.filter((o) => !DECLINE.test(o));

    // The same answer, decorated: "No" → "No, I do not require sponsorship".
    const decorated = answers.find((o) => leads(o, answer));
    if (decorated) return decorated;

    // An explicit Yes or No carries over: "No, I do not have a disability" → "No".
    const yesNo = a.match(/^(yes|no)\s*(,|$)/);
    return yesNo ? answers.find((o) => leads(o, yesNo[1])) || null : null;
  }

  /**
   * Resolves a field to a concrete value from stored preferences.
   * Returns null when there is no standing answer — the run then stops and asks.
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
    matchOption,
    load,
    save,
    setOne,
    isComplete,
    unanswered,
  };
})();
