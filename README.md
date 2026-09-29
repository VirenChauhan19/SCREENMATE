# SCREENMATE

**The agent that understands where you are.**

---

## Problem

People move information between software and AI assistants by hand. You copy your
background into a chat window, paste the job description after it, explain what the
form is asking, get an answer back, then copy it into the field it was always meant
for. The assistant never saw the form. It doesn't know which fields are empty, which
ones failed validation, which ones you already answered, or which ones it has no
business answering at all.

That gap is not a model problem. It's a context problem.

## Solution

SCREENMATE is a context-aware action layer embedded directly into software.

It reads the application's live state, decides whether external research would
actually help, takes real actions through tools, verifies that each action landed,
and stops when a question requires human judgment.

## Two surfaces, one agent

SCREENMATE ships as a **Chrome extension** that works on real job application
forms, and as a **Next.js portal** used as a reliable demo fallback.

They are the same agent. The only thing that differs is where `ApplicationState`
comes from and where tool writes land:

| | Web app | Extension |
|---|---|---|
| State source | React state it owns | the live DOM of a page it has never seen |
| Tool writes | `setState` | native setter + `input`/`change` events |
| Verification | re-read React state | re-read the DOM |
| Policy, agent, research | identical | identical |

The policy layer never ships to the browser. The extension sends the fields it
found to `/api/classify` and the server decides what may be touched, so there is
exactly one copy of the safety rules. If the backend is unreachable the extension
fails closed and refuses to act.

## Demo

### Autofill with fewer interruptions

The extension starts from your saved profile and answers immediately; the standing-answer
questionnaire is optional. It fills matching answers, attaches your saved resume when
enabled, and rescans for questions revealed by earlier answers before pausing. Unknown
optional questions stay blank unless you explicitly selected **Ask each time**.
Required facts that are missing still need an answer: SCREENMATE does not invent them.

Answers entered in the extension are remembered by default (uncheck **Remember this
answer** to opt out). Matching tolerates question punctuation and common equivalent
wordings, while preserving distinctions such as country, inverted questions, and
previous versus desired salary. A repeated question on the same step reuses the answer
you just saved. Manage saved answers in the extension settings.

The web demo also remembers confirmed choices on this browser, scoped to the applicant
and exact question. Editing a remembered choice updates it; clearing it forgets it.
Web-demo memory and extension memory are separate.

Cross-site filling runs through the extension. Coverage is based on the controls a
portal exposes, not a promise that every portal works. Native fields, supported ARIA
widgets, open shadow roots, and accessible application frames can be handled; login,
CAPTCHA, closed widgets, and missing required information can still need intervention.
Submission remains a separate explicit action.

Local checks: `npm test`, `npm run typecheck`, `npm run lint`. Run
`node scripts/ui-harness-server.js` and open `http://127.0.0.1:8101/autofill`
to exercise duplicate questions, a dynamically revealed school field, optional gaps,
and remembered answers after reload without sending anything to an employer.

The portal surface is a job application for a **Software Developer Intern** role
at **Nova Systems**. Some fields arrive pre-filled, the way a real portal that already
knows you would behave. The rest are empty.

Press **Run SCREENMATE** and it:

1. **Observes** the live form — 9 open fields, 2 of them sensitive.
2. **Plans** — states a goal and a 4-6 step plan before touching anything.
3. **Decides about research** — the motivation question asks why you want *this*
   company, which the profile and job description cannot answer between them. So it
   calls Exa. If only stored facts were missing, it says so and skips the call.
4. **Acts** — fills location, degree, graduation date, portfolio, LinkedIn, and skills
   from the profile, then writes an original motivation answer grounded in the
   profile, the job description, and the research.
5. **Verifies** every write by re-reading application state — field exists, value
   committed, no validation error, counted as complete.
6. **Stops** at the sponsorship question and hands it back to you.
7. **Continues** once you answer.
8. **Validates** the whole application against eight checks.
9. **Asks you to review** everything it changed, with a before/after diff. Nothing is
   ever submitted.

## Why the environment matters

Take SCREENMATE out of the application and most of what it does becomes impossible —
not harder, impossible. It depends on things that only exist inside the software:

- **Live form state.** It knows `portfolio` is empty and `university` is not. A chat
  assistant has to be told, every time, and gets a snapshot that's stale on arrival.
- **Field metadata.** Each field carries a type, a required flag, allowed options, and
  a policy level. That's what makes "you must use `selectOption` with one of these two
  values" enforceable rather than advisory.
- **Validation errors.** The agent reads real validation output and re-reads it after
  every write. Verification is only meaningful against an environment that can
  disagree with you.
- **The user's edits.** Delete the portfolio after the agent filled it and SCREENMATE
  notices the environment changed under it, says so, and asks what you want — rather
  than silently re-filling or carrying on with a stale plan.
- **Available actions.** The agent doesn't emit text hoping you'll paste it. It calls
  `fillField` and the field changes.
- **Sensitive fields.** The application declares which questions are legally or
  personally yours. The agent is structurally unable to answer them.

A chat window has none of this. It has a transcript.

## Architecture

```
Application (job portal UI)
        ↓
ApplicationState ── live, structured, validated
        ↓
SCREENMATE Agent
        ├── OpenRouter ── plan → act → regenerate (schema-validated JSON)
        ├── Exa.ai ────── only when an open field needs external context
        ↓
Tool Execution ── guarded, grounded, refusable
        ↓
Verification ── re-read state, confirm the change landed
        ↓
Updated ApplicationState ── back to the top
```

### Files

```
src/lib/policy.ts        SAFE / REVIEW / SENSITIVE — the single source of truth
src/lib/grounding.ts     anti-hallucination guard, shared by both surfaces
src/lib/types.ts         shared domain types
src/lib/profile.ts       the user profile — the ONLY source of personal facts
src/lib/application.ts   field definitions, roles, derived state, validation report
src/lib/tools.ts         the six tools, every guard, and verification
src/lib/openrouter.ts    schema-validated model calls
src/app/api/agent/       plan / act / regenerate phases
src/app/api/research/    Exa search → normalized, source-attributed briefing
src/app/api/classify/    policy applied to fields scraped from any page
src/app/api/parse-cv/    CV → structured profile (PDF, DOCX, text)
src/app/api/health/      deploy diagnostics; reports config, never secrets
src/lib/auth.ts          access key + CORS for the hosted API
src/lib/cv.ts            text extraction
src/hooks/useScreenmate  the orchestration loop (web)

extension/manifest.json  MV3
extension/background.js  service worker — network calls, keys never exposed; carries a
                         run across page loads; relays an iframe form's panel
extension/content/scan.js    DOM → ApplicationState (ARIA widgets, shadow DOM, stable ids)
extension/content/nav.js     wizard navigation; the submit refusal lives here
extension/content/prefs.js   standing answers + cross-site option matching
extension/content/act.js     tool writes into the DOM, file attach, verification
extension/content/panel.js   the panel, in a shadow root
extension/content/frames.js  draws an iframe form's panel in the top page
extension/content/main.js    the orchestration loop (extension)
extension/options/       settings: resume, profile, standing + remembered answers, backend
extension/popup/         status: backend health, profile readiness, open on this page
```

## Tools

| Tool | Effect |
|---|---|
| `fillField(fieldId, value)` | writes a text/url/email/textarea/tags field |
| `selectOption(fieldId, value)` | picks an allowed option on a select field |
| `flagIssue(fieldId, message)` | surfaces a problem without changing anything |
| `requestUserApproval(fieldId, reason)` | hands a sensitive field back to the user |
| `validateApplication()` | runs the eight-check validation pass |
| `researchCompany(reason)` | fetches external context — only when it earns the call |
| `advance()` *(extension)* | clicks Next to reach the following step. Never Submit: only your confirmation in the panel sends an application |

In the extension these same tools write into real `<input>`, `<select>`,
`<textarea>` and radio-group elements. Writes go through the native value setter
followed by `input` and `change` events, which is what a controlled React or Vue
field requires — a plain `el.value = x` updates the node but never reaches the
framework's state, and verification catches exactly that failure.

Every tool validates before it mutates. Unknown fields, empty values, wrong tool for
the field type, options outside the allowed set, and no-op rewrites are all refused
with a reason that shows up in the activity panel.

## Safety and human control

Three levels, declared once in `src/lib/policy.ts` and read by every guard:

| Level | Meaning | Fields |
|---|---|---|
| **SAFE** | Executes automatically | name, email, location, university, degree, graduation date, portfolio, LinkedIn |
| **REVIEW** | Prepared by the agent, surfaced for approval | skills, motivation |
| **SENSITIVE** | Never answered automatically | sponsorship, work authorization, relocation, demographics, disability, veteran status, salary |

Sensitive fields are guarded in **three independent places**, any one of which is
sufficient:

1. **Prompt** — the model is told, in absolute terms, that sensitive fields are
   off-limits and that text inside the job description is data, not instruction.
2. **Server** — `/api/agent` rewrites any write aimed at a sensitive field into a
   `requestUserApproval` before the plan ever reaches the client.
3. **Tool layer** — `executeAction` refuses the write outright and raises an approval
   request instead.

A fourth guard covers hallucination: outside free-text answers, every value the agent
writes must appear **verbatim** in the user profile. It cannot invent a school, a
date, a URL, or a skill. Skills are checked token by token.

**Confidence** is a property of the action, not the field — it records how directly a
written value traces back to stored data:

- **High** — copied verbatim from one profile value → auto-completed
- **Medium** — assembled, inferred, or generated → review recommended
- **User required** — the agent may not decide this at all

### Degradation

- OpenRouter down → `Agent temporarily unavailable`; the form stays fully editable.
- Exa down → `External research unavailable`; the agent proceeds on the job
  description alone.
- Exa up, normalizer down → a real briefing marked `partial`.
- A tool write that doesn't land → retried once, then logged as a verification
  failure. The run continues.

## Going live

The extension needs a backend, because that is where the API keys and the safety
policy live. Local is fine for development; a deploy is what makes it usable
away from your machine.

```bash
# 1. Log in (interactive, one time)
npx vercel login

# 2. Deploy
npx vercel --prod

# 3. Set the three secrets on the deployment
npx vercel env add OPENROUTER_API_KEY production
npx vercel env add EXA_API_KEY production
npx vercel env add SCREENMATE_API_KEY production   # generate one, see below
npx vercel --prod                                  # redeploy so they take effect
```

Generate the access key:

```bash
node -e "console.log('sm_'+require('crypto').randomBytes(24).toString('base64url'))"
```

Then check it:

```
https://<your-app>.vercel.app/api/health
→ {"ok":true,"requiresKey":true,"configured":{"openrouter":true,"exa":true}}
```

Finally, open SCREENMATE's settings (toolbar icon → **Profile, resume &
settings**), set **Server URL** to your deployment and paste the **access key**.
Chrome will ask to allow that host — that is the `optional_host_permissions`
grant, requested only for the backend you chose.

### Why there is an access key

Deployed, these routes are a public endpoint spending real OpenRouter and Exa
credits. `SCREENMATE_API_KEY` gates them. Requests from the deployment's own
origin are allowed through so the bundled web demo keeps working.

Be clear about what that is worth: an `Origin` header can be forged, so this is a
deterrent against a shared URL quietly draining your credits, not a defence
against someone who actually wants in. If this were more than a demo, the real
control is rate limiting at the edge.

If `SCREENMATE_API_KEY` is unset the gate is open, which keeps local development
frictionless. `/api/health` reports which mode is live so a misconfigured deploy
is obvious rather than silently public.

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in the two keys
npm run dev
```

### Portal coverage

SCREENMATE has no per-site code. It reads whatever the page exposes — native
controls, ARIA widgets, open shadow roots — and falls back to "text" rather than
skipping a control it does not recognise. What that buys, verified against
fixtures built on each platform's real DOM patterns:

| Shape | What makes it awkward | Status |
|---|---|---|
| Plain HTML forms | nothing | works |
| Greenhouse-style | `react-select` div controls, file upload, consent box | works |
| Lever-style | radio groups whose options carry their own `<label>` | works |
| Ashby-style | typeahead that only opens its list once you type | works |
| Workday-style | `data-automation-id` widgets, portaled listboxes, wizard | works |
| Taleo / iCIMS-style | the whole form lives in an **iframe** | works |
| Wizards that load a new page per step | the run's script dies with each page | works |

The content script runs in every frame, because an embedded form sits in an
iframe while the job posting sits in the parent. Frames that find a form announce
themselves and the richest one runs the form. Its panel is drawn by the **top**
page (an embedded form's iframe is often taller than the screen, so a panel
pinned inside it would scroll away), with state and clicks relayed through the
extension's own messaging, which the page cannot read or forge. The job title,
company and description are read from the **parent** page — the iframe alone
knows nothing about the job.

Questions are read the way a screen reader would name them (`aria-labelledby`
before `aria-label`, and never a placeholder like "Select…"), falling back to the
text written just above an unlabelled control. Radio groups and "check all that
apply" boxes are one question each. Every question keeps the same id for the
life of the page, so an answered one is never asked again because something
appeared above it.

Resume uploads are filled from the resume you saved in settings; any other file
(a cover letter) is yours to attach, and an optional one does not stop the run.
Anything matching a protected topic is never answered by the agent.

Verified end to end against live employer postings, not only fixtures: a full
run (fill, verify, ask, review, never submit) on each of these:

| Live posting | What it exercised |
|---|---|
| Discord (Greenhouse) | react-select country and location pickers, phone widget, 11 EEO answers from standing answers, resume attach |
| Palantir (Lever) | a 33-box "check all that apply", resume attach that makes the site fill fields, Singapore citizenship locked as sensitive |
| Ramp (Ashby) | location typeahead, consent radios whose question is a plain paragraph, "prove you're not a bot" questions handed to you |
| Hugging Face (Workable) | styled radios over hidden inputs, URL fields that are textareas |
| Rippling | unlabelled dropdowns, a sponsorship question that is only a paragraph above one |
| Discord, embedded in a company page | the iframe case, panel drawn in the top page |

`npm run probe:real` opens real application pages and reports what the scanner
sees — read-only: it never writes a field, never clicks a navigation control,
never submits.

Limits worth stating: a portal that renders inputs into a *closed* shadow root,
or draws its form on a canvas, is unreadable. Expired or listing-only pages
return too few fields, and the probe says so rather than pretending. When a page
defeats the scanner it reports that instead of guessing.

### Multi-step applications

Real applications are wizards. SCREENMATE fills a step, verifies every write,
clicks **Next**, re-scans the new step, and keeps going — up to 8 steps. A
portal that loads a whole new page for each step (iCIMS, Taleo, many older
ones) ends the page's script mid-click; the run leaves a note with the
extension first, and the next page picks it up where it left off. A "Next" that
is not part of the form (a results list's pagination, a carousel) is never
clicked.

Before leaving a step, everything required that is still empty, and every
sensitive question without a standing answer, is asked of you in the panel,
with the right input: the site's own dropdown options, a text box for essays, a
file picker for uploads. Your answer goes into the form and is verified; if the
page does not take it, the question stays open and says why.

The agent will **never** click Submit on its own. That is enforced in `nav.js`,
not left to the model, because a submitted application cannot be taken back:
anything matching submit / apply now / finish / confirm and… / agree and… is
refused, "Submit and continue" included. When no Next button remains, the panel
offers **Submit application**, then **Confirm**. Only that second click presses
the site's submit button, and the panel reports what the site said: its
confirmation, or the fields it rejected. A disabled submit button is reported
as such, not pressed.

### Pointing a checkout at the deployment

`extension/config.json` (gitignored, so the key never lands in the repo) sets the
backend for an unpacked checkout:

```json
{ "backendUrl": "https://your-app.vercel.app", "apiKey": "sm_..." }
```

Without it the extension defaults to `localhost:3000` and reports it cannot
reach the backend — correct on a dev machine, useless anywhere else.

An install that already saved `localhost` is repaired rather than left broken:
a stored localhost URL was never a deliberate choice, so a bundled backend
supersedes it. That happens when the popup opens, not only at browser restart,
so clicking the icon is enough to fix it. A URL you typed yourself is left alone.

### Giving it to someone else

An unpacked checkout defaults to `localhost:3000`, which on a stranger's laptop
is nothing. Package a build that carries its own backend instead:

```bash
npm run package:ext --   --backend=https://your-app.vercel.app   --key=sm_your_access_key
```

That writes `dist/screenmate-<version>.zip` containing a `config.json` the
service worker reads on install. The recipient unzips it, loads it unpacked, and
is connected — no URL to type, no key to paste. `npm run recipient:test` proves
that: it unpacks the zip into a clean directory, installs it into a fresh Chrome
profile, changes nothing, and asserts the popup reaches the hosted API.

Packaging refuses a localhost `--backend`, because that failure only shows up on
the other person's machine.

**The zip contains your access key.** Anyone holding the file can spend your
OpenRouter and Exa credits. Hand it to people directly, do not post it, and
rotate `SCREENMATE_API_KEY` when you want to cut a build off. Omit `--key` to
make recipients paste their own.

For anything wider than handing out zips, the Chrome Web Store is the real
answer: a developer account, a one-off fee, and review time measured in days.

### Your resume and profile

A fresh install opens the settings page with a short setup. It starts with an
empty profile: whatever sits there is typed into real applications, so there is
no sample data to forget to replace.

Add your resume (**PDF, DOCX or plain text**) and two things happen. The file is
kept on this device, and attached wherever an application asks for a resume —
before anything else is filled, since some sites (Lever, Rippling) read it and
fill fields from it; the agent then corrects anything the site's own reader got
wrong. And its text is read into your profile: extracted server-side (`pdfjs`
for PDF, the document XML for DOCX), with a model pulling out the fields.

It is a parser, not a writer: values are copied verbatim, and anything the CV
does not state comes back as **missing** rather than invented — these values get
typed into real applications, so a wrong one is worse than a blank one. Nothing
is saved until you see a before/after diff and apply it; **applying saves it**,
with no second button to forget. Automatic attaching can be turned off.

The profile covers what forms ask: name, email, phone, city, country, current
company and title, education, website, LinkedIn, GitHub and skills. The settings
page flags anything essential that is missing, and any sample value left over
from an old build.

A scanned, image-only PDF has no text layer, and the settings page says so
instead of returning an empty profile.

### Fixing the agent's work

Every change the agent makes appears in the panel with **Edit**, **Regenerate**
(for generated prose) and **Revert**, per field. An edit writes straight to the
page and is re-verified like any other write; the field is then marked as yours
rather than the agent's. An editor you have open, and anything typed into it,
survives the panel re-rendering.

### Standing answers

Every application asks the same dozen questions. Answering them mid-run, on every
site, is worse than answering once — so the first run collects them:

work authorization · sponsorship · relocation · work arrangement · salary ·
start date · gender · ethnicity · veteran status · disability status

The safety property is unchanged, and worth being precise about: the agent still
never *decides* a sensitive question. It transcribes a decision **you** already
made, and labels it that way in the activity log. Anything left as *Ask each
time* still stops the run.

Answers are matched by topic, not by wording, so "No" set once also answers
"No, I do not require sponsorship" on the next site. Before offering you choices
on a custom dropdown, the extension opens it and reads the real options — it will
not guess "Yes/No" at a question whose answers are nothing of the kind.

Any other question you answer in the panel (your phone, "How did you hear about
us?") can be remembered too, keyed by its wording. The settings page lists
these **remembered answers**, and forgetting one means you are asked again.

### Chrome extension

1. `npm run dev` — the extension needs the backend for the agent, research, and
   the policy layer. API keys never enter the extension.
2. Open `chrome://extensions`, enable **Developer mode**, choose
   **Load unpacked**, and select the `extension/` folder. The settings page
   opens: add your resume and check your profile.
3. Visit any job application page. A collapsed SCREENMATE pill appears when the
   page looks like an application form, including one a single-page site shows
   only after you press Apply. Click it, or press **Alt+Shift+S** on any page.
4. The toolbar icon shows whether the backend is reachable and your profile is
   ready, and opens settings.

Auto-detection is deliberately conservative: it needs at least four fields,
something name- or email-shaped, and either six-plus fields or a resume/cover
letter/experience question. A login box will not summon a panel, and a pill you
close stays closed on that page.

```
OPENROUTER_API_KEY=sk-or-...
EXA_API_KEY=...
OPENROUTER_MODEL=anthropic/claude-sonnet-4.5   # optional
```

Both keys are read only in server routes. Nothing reaches the client.

```bash
npm run typecheck      # tsc --noEmit
npm run build          # production build
npm run e2e            # drives the real APIs end-to-end, asserts the outcome
npm run fixture:serve  # serves fixtures/apply.html on :8099
npm run ext:e2e        # single page, "Ask each time" branch
npm run ext:workday    # multi-step wizard, standing-answers branch
npm run portals:coverage  # what the scanner SEES on 4 ATS shapes
npm run portals:writes    # what it can CHANGE on those shapes
npm run portals:iframe    # full run inside an iframe-embedded portal
npm run package:ext       # zip the extension into dist/
```

`npm run e2e` needs the dev server running. It exercises plan → research → act →
verify → approval → validation and prints a PASS/FAIL line.

`npm run ext:e2e` needs both the dev server and `fixture:serve`. It installs the
unpacked extension into real Chrome, opens a fixture job form on a **different
origin** than the backend, and asserts that: the scanner skips hidden, CSRF and
password inputs; a write into a genuinely React-controlled input reaches React's
own state (not just the DOM node); every safe field is filled and verified; and
sponsorship, salary and veteran-status fields are all left untouched and queued
for the user.

`npm run ext:workday` runs the harder case: a four-step, Workday-shaped wizard
built on the same patterns Workday uses — `data-automation-id` hooks, button +
portaled-listbox dropdowns, ARIA radio groups, async step transitions, and a
Submit button on the final step. It asserts that the agent walks all four steps,
sets custom dropdowns correctly, writes each stored answer **exactly** as you set
it, and **never submits**.

### Free-text answers

Generated answers are constrained toward something a person would type: varied
sentence length, contractions, a concrete detail from your profile, and a banned
list of the usual tells (*passionate, excited to, delve, leverage, resonates,
robust, seamless, cutting-edge…*). Em-dashes are stripped deterministically after
generation, because the prompt alone does not hold that one.

## Tech

Next.js · React · TypeScript · Tailwind CSS · OpenRouter · Exa.ai

## Hackathon

Built during **AI Tinkerers — Agents, Everywhere**, 2026.
