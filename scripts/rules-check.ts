/**
 * The two rules that decide what SCREENMATE types into a real form, checked
 * against wording taken from real portals. No backend, model or browser.
 *
 *   1. Grounding: outside free text, a value must come from the profile.
 *   2. Standing answers: which question a field asks, and a stored answer
 *      mapped onto this site's options.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isGroundedValue } from "../src/lib/grounding";
import { topicFor } from "../src/lib/policy";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` — got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`,
  );
}

/* ---------------- 1. grounding ---------------- */

const profile = {
  name: "Viren Chauhan",
  email: "viren@example.com",
  phone: "+1 404 555 0100",
  university: "SCAD",
  degree: "BFA Game Design",
  portfolio: "https://virenchauhan.com",
  linkedin: "https://linkedin.com/in/example",
  github: "https://github.com/example",
  location: "Atlanta, Georgia",
  skills: ["React", "TypeScript"],
};

const grounded: [string, string, string, boolean][] = [
  ["First Name", "text", "Viren", true],
  ["Last Name", "text", "Chauhan", true],
  ["Full name", "text", "Viren Chauhan", true],
  ["Phone, as stored", "text", "+1 404 555 0100", true],
  ["Phone, other punctuation", "text", "(404) 555-0100", true],
  ["Phone Number beside a +1 picker", "text", "4045550100", true],
  ["GitHub", "text", "https://github.com/example", true],
  ["Phone with a digit changed", "text", "(404) 555-0199", false],
  ["Phone missing its area code", "text", "555-0100", false],
  ["Phone with a country code added", "text", "+44 404 555 0100", false],
  ["A name that is not yours", "text", "Vivek", false],
  ["School, site's wording", "select", "Savannah College of Art and Design", false],
  ["Degree, site's wording", "select", "Bachelor's Degree", false],
  ["Yes/No question", "select", "Yes", false],
  ["Consent checkbox", "select", "Checked", false],
];

console.log("\n=== grounding: what the agent may write ===");
for (const [name, type, value, want] of grounded) {
  check(`${name}: "${value}"`, isGroundedValue(type, value, profile), want);
}

/* ---------------- 2. standing answers ---------------- */

const topics: [string, string, string | null][] = [
  ["job_application[gender]", "Gender", "gender"],
  ["question_7", "Sex", "gender"],
  ["question_8", "Sexual orientation", null],
  ["question_10", "Are you a registered sex offender?", "criminalHistory"],
  ["job_application[hispanic_ethnicity]", "Are you Hispanic/Latino?", "ethnicity"],
  ["job_application[veteran_status]", "Veteran Status", "veteran"],
  ["job_application[disability_status]", "Disability Status", "disability"],
  ["question_9", "Will you now or in the future require visa sponsorship?", "sponsorship"],
];

console.log("\n=== standing answers: which question a field asks ===");
for (const [id, label, want] of topics) {
  check(`"${label}"`, topicFor(id, label), want);
}

const prefsWindow: Record<string, any> = {};
new Function("window", "chrome", readFileSync(join(__dirname, "../../extension/content/prefs.js"), "utf8"))(
  prefsWindow,
  { storage: { local: {} } },
);
const matchOption: (answer: string, options: string[]) => string | null =
  prefsWindow.__screenmatePrefs.matchOption;

const DISABILITY = [
  "Yes, I have a disability, or have had one in the past",
  "No, I do not have a disability and have not had one in the past",
  "I do not want to answer",
];
const VETERAN = [
  "I am not a protected veteran",
  "I identify as one or more of the classifications of protected veteran",
  "I don't wish to answer",
];

// null means "ask the user": never guess a protected answer.
const mapped: [string, string, string[], string | null][] = [
  ["Disability decline, US form wording", "I do not wish to answer", DISABILITY, "I do not want to answer"],
  ["Disability No", "No, I do not have a disability", DISABILITY, DISABILITY[1]],
  ["Veteran decline, Greenhouse wording", "I do not wish to answer", VETERAN, "I don't wish to answer"],
  ["Veteran, ambiguous on Lever", "I am a protected veteran", ["I am a veteran", "I am not a veteran", "Decline to self-identify"], null],
  ["Gender decline", "I do not wish to answer", ["Male", "Female", "Decline To Self Identify"], "Decline To Self Identify"],
  ["Decline with no decline offered", "I do not wish to answer", ["Male", "Female"], null],
  ["Race answer on the Hispanic/Latino yes-no", "Hispanic or Latino", ["Yes", "No", "Decline To Self Identify"], null],
  ["Race, site decorates it", "Asian", ["White (Not Hispanic or Latino)", "Asian (Not Hispanic or Latino)"], "Asian (Not Hispanic or Latino)"],
  ["Sponsorship No, decorated", "No", ["Yes", "No, I do not require sponsorship"], "No, I do not require sponsorship"],
  ["Relocation No is not a decline", "No", ["Yes, I am willing to relocate", "No, I do not want to relocate"], "No, I do not want to relocate"],
  ["No is not None", "No", ["Yes", "None of the above"], null],
  ["No preference is not No", "No preference", ["Yes", "No"], null],
];

console.log("\n=== standing answers: stored answer -> this site's option ===");
for (const [name, answer, options, want] of mapped) {
  check(name, matchOption(answer, options), want);
}

console.log(`\nRESULT: ${failures ? `FAIL (${failures})` : "PASS"}`);
process.exitCode = failures ? 1 : 0;
