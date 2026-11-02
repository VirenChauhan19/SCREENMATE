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

SCREENMATE ships as a **Chrome extension** for real job application forms and a
**Next.js workspace** for preparing your profile, importing a CV, installing the
extension, and checking your connection. The sample application lives at `/demo`.

### Use it on an application

1. Open `/` and unlock website access with the server's `SCREENMATE_API_KEY`.
2. Enter your own details or read a CV, review the extracted details, and save.
   Website profiles are stored in this browser; they are not cloud accounts.
3. Download the extension from the workspace, extract the ZIP, and use **Load
   unpacked** at `chrome://extensions` with Developer mode enabled. This download
   points at the website you used and contains no access key or personal data.
4. Save the access key in the extension popup. Refresh the workspace and choose
   **Send profile to extension**. Alternatively, download a profile copy and
   import it in the popup, then review and save it.
5. Open the employer's actual application form and run SCREENMATE from its panel.
   New installs start with an empty profile. Existing sample profiles require
   explicit review and saving before they can run.

The extension can help with visible native and ARIA form controls, including
iframes and many SPA steps. Sign-in, CAPTCHAs, uploads, unsupported controls, and
final submission remain manual. If a step causes a full page reload, reopen
SCREENMATE and run it on that page. Compatibility must be checked on the actual
employer form; fixture coverage does not guarantee every Workday or other ATS site.

`npm test` checks authentication, server policy enforcement, extension packaging,
profile transfer boundaries, and selected real-form regressions without AI calls.
`npm run e2e` exercises the configured AI/research backend on sample application
data; it does not submit an employer application.

### Personalized written answers

The extension fills written answers directly into single-line and multiline
application questions. It combines the applicant's saved skills, education,
professional summary, work experience and projects with the actual employer's
job description and any company research gathered for that role. Add this context
in the website or extension profile, or review and import it from a CV.
For embedded applications, the form frame refreshes the enclosing page's job
context before classification. Job metadata in the active form takes precedence;
changing the employer or role clears prior company research.

Ordinary answerable questions need no approval before filling. A question about
a specific past event needs real supporting experience; missing facts and personal
decisions are requested instead of invented. Written answers remain editable and
can be rewritten in the review panel. Field character and word limits are passed
to generation and checked on the server. The live character limit is also checked
before a DOM write.
Oversized answers get up to two rewrite attempts with measured length feedback,
never a silent text cut.
A separate AI review checks personal claims against the saved profile before
an answer is written. It can correct unsupported claims or request a missing
personal detail. This reduces invented experience but does not guarantee that
every answer is correct.
Long answer requests have a bounded deadline and keep Chrome's background
worker active only while the request is pending, following the
[Chrome service-worker guidance](https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers#keep-the-service-worker-alive).

`npm run answers:e2e` tests the configured AI backend with a synthetic applicant
and two fictional jobs. It checks that answers differ by role, fit the field,
produce direct fill actions, and request absent personal history. It does not
open or submit an employer application. Its results are saved to
`dist/personalized-answer-check.json`.

### Automatic field and dropdown filling

The extension fills recognizable personal, contact, address and education facts
directly from your saved profile before generating written answers. Store city,
state/province, country and postal code separately for precise address matching.
First and last names are explicit fields; SCREENMATE does not guess name order.

Dropdown matching uses the choices the page exposes. It understands common country
aliases, country-specific US/Canadian region abbreviations, degree levels and
explicit school acronyms. It searches remote comboboxes with a profile-derived
query and scrolls bounded virtualized lists. It restores temporary search text,
waits for selection confirmation, and rescans when dependent fields or options
change. Phone masks can change punctuation but must preserve every digit.

It keeps existing/user-edited answers and leaves ambiguous choices for review.
Known facts do not need a model call; AI batches continue only while verified writes
make progress. Sensitive declarations still require a compatible saved answer or
your input, and final submission remains yours.

`npm test` includes the real orchestration loop, semantic matching and asynchronous
widget models. For actual browser fixtures, run `npm run compatibility:serve`, open
`http://127.0.0.1:8100/`, and follow the smart-dropdown checks link. These fixtures
do not establish compatibility with every live employer portal.

The 1.2.1 update adds pointer/mouse event sequences for custom selects, required
field and native validation blockers, and recovery when an embedded application
frame is replaced. It also keeps navigation inside the application form and
reports required uploads hidden behind visible upload controls. Dropdown event
coverage follows the interaction handlers in
[MUI Select](https://github.com/mui/material-ui/blob/master/packages/mui-material/src/Select/SelectInput.js)
and [Radix Select](https://github.com/radix-ui/primitives/blob/main/packages/react/select/src/select.tsx);
the automated tests use event-driven models, not live instances of those libraries.
Live employer-site verification is still pending: the available browser connection
rejects this session's authentication. A full document navigation currently needs
another Run on the new page; in-page wizard changes are handled automatically.

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
src/lib/profile.ts       sample profile used only by the demo
src/lib/applicant.ts     website applicant profile schema
src/components/Workspace.tsx  profile, CV review, connection and extension setup
src/lib/application.ts   field definitions, roles, derived state, validation report
src/lib/tools.ts         the six tools, every guard, and verification
src/lib/openrouter.ts    schema-validated model calls
src/app/api/agent/       plan / act / regenerate phases
src/app/api/research/    Exa search → normalized, source-attributed briefing
src/app/api/classify/    policy applied to fields scraped from any page
src/app/api/parse-cv/    CV → structured profile (PDF, DOCX, text)
src/app/api/health/      deploy diagnostics; reports config, never secrets
src/lib/auth.ts          access key, signed website sessions and extension CORS
src/app/api/session/     website unlock and lock
src/app/api/extension/   credential-free extension download for this server
src/lib/cv.ts            text extraction
src/hooks/useScreenmate  the orchestration loop (web)

extension/manifest.json  MV3
extension/background.js  service worker — all network calls, keys never exposed
extension/content/scan.js    DOM → ApplicationState (ARIA widgets, shadow DOM)
extension/content/nav.js     wizard navigation; the submit refusal lives here
extension/content/prefs.js   standing answers + cross-site option matching
extension/content/act.js     tool writes into the DOM + verification
extension/content/panel.js   the panel, in a shadow root
extension/content/main.js    the orchestration loop (extension)
extension/popup/         profile editor + backend URL
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
| `advance()` *(extension)* | clicks Next to reach the following step. Never Submit |

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

Finally, open the extension popup, set **Server URL** to your deployment and
paste the **access key**. Chrome will ask to allow that host — that is the
`optional_host_permissions` grant, requested only for the backend you chose.

### Why there is an access key

`SCREENMATE_API_KEY` gates the paid APIs. The extension sends it in a header;
the website exchanges it for a signed, HttpOnly, SameSite session lasting 12 hours.
The key is not stored in website browser storage or included in website extension
downloads. Origin headers alone never grant access. Changing the server key
invalidates existing sessions.

Production fails closed if `SCREENMATE_API_KEY` is missing. Keyless access is
limited to a loopback development server. `/api/health` reports provider
configuration, not a guarantee that a provider is currently accepting requests.
This is a private, shared-key application, not a multi-user account service.

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

The content script runs in every frame, because an embedded form sits in an
iframe while the job posting sits in the parent. Frames that find a form announce
themselves and the richest one takes the panel, so exactly one panel appears. The
job title, company and description are then read from the **parent** page — the
iframe alone knows nothing about the job.

Three classes of field are surfaced but never filled: **file uploads** (a resume
has to come from your machine), **consent checkboxes**, and anything matching a
protected topic.

Earlier read-only probes also covered live employer postings. `npm run probe:real`
opens real application pages and reports what the scanner sees — read-only: it
never writes a field, never clicks a navigation control, never submits.

A representative run:

| Live posting | Fields | Locked as sensitive |
|---|---|---|
| Cloudflare (Greenhouse) | 25 | sponsorship, gender, ethnicity, veteran, disability, start date |
| Instrumentl (Lever) | 11 | work authorization, sponsorship |
| Metabase (Lever) | 12 | none present on that form |
| Supermove (Lever) | 11 | none present on that form |

Limits worth stating: a portal that renders inputs into a *closed* shadow root,
or draws its form on a canvas, is unreadable. Expired or listing-only pages
return too few fields, and the probe says so rather than pretending. When a page
defeats the scanner it reports that instead of guessing.

### Multi-step applications

Run `npm run compatibility:serve` and open `http://127.0.0.1:8100/` to run the
local browser regression suite. It exercises the existing portal fixtures plus
delayed dropdown options, shadow-root labels and selects, repeated field names,
separate radio groups, required consent, framework element replacement, late
application dialogs, automatic profile and saved-answer selection without dropdown
prompts, and navigation refusal. No model calls or employer submissions
are made. Run `npm run compatibility:policy` for the matching server-policy checks.

Compatibility depends on the controls a site exposes; these checks establish
fixture coverage, not a guarantee for every live employer portal. Account sign-in,
CAPTCHAs, document uploads, and unsupported widgets require user input.

Real applications are wizards. SCREENMATE fills a step, verifies every write,
clicks **Next**, re-scans the new step, and keeps going — up to 8 steps.

It will **never** click Submit. That is enforced in `nav.js`, not left to the
model, because a submitted application cannot be taken back. Anything matching
submit / apply now / finish / confirm and… / agree and… is refused, and a button
reading "Submit and continue" is refused too. When no Next button remains, the
run stops and hands you the submit control explicitly.

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

### Importing your CV

The popup reads a **PDF, DOCX or plain-text** CV and fills your profile from it.
Text is extracted server-side (`pdfjs` for PDF, the document XML for DOCX) and a
model pulls out the structured fields.

It is a parser, not a writer: values are copied verbatim, and anything the CV
does not state comes back as **missing** rather than invented — these values get
typed into real applications, so a wrong one is worse than a blank one. Nothing
is saved until you see a before/after diff and apply it.

**Applying an import saves it.** There is no second button to forget, and the
popup then shows which CV the profile came from and when — so you are never left
wondering whether to upload it again. Your profile lives in `chrome.storage`
on that device; the CV itself is never stored, only the fields extracted from it.

A scanned, image-only PDF has no text layer, and the popup says so instead of
returning an empty profile.

### Fixing the agent's work

Every change the agent makes appears in the panel with **Edit**, **Regenerate**
(for generated prose) and **Revert**, per field. An edit writes straight to the
page and is re-verified like any other write; the field is then marked as yours
rather than the agent's. An editor you have open, and anything typed into it,
survives the panel re-rendering.

### Standing answers

Every application asks the same dozen questions. Answering them mid-run, on every
site, is worse than answering once. The optional **Saved answers** panel stores them:

work authorization · sponsorship · relocation · work arrangement · salary ·
start date · gender · ethnicity · veteran status · disability status

The safety property is unchanged, and worth being precise about: the agent still
never *decides* a sensitive question. It transcribes a decision **you** already
made, and labels it that way in the activity log. Dropdowns do not pause the run:
matching profile values and saved answers are selected automatically, while unknown
answers remain incomplete and are flagged for final review. Explicit degree levels
can map to a portal's category, such as BFA to "Bachelor's degree". Standing-answer setup
is optional. Other user-only tasks, such as document uploads, can still pause.

Saved answers are reused only when the question's meaning is compatible. Inverted
sponsorship wording, citizenship questions, salary, and availability declarations
remain manual rather than reusing a potentially different decision. The extension
reads each dropdown's real choices before selecting; ambiguous matches remain for review.
Phone numbers are saved with the profile and included when importing a CV. Phone
type defaults to Mobile (or the site's equivalent Cell/Cellular choice), as
requested. A phone number must be present in the saved profile to fill it.

While a run is active, real clicks, typing, selections and scrolling invalidate
outstanding actions. After interaction settles, SCREENMATE rescans and continues.
It preserves fields you edit or clear, keeps your typing focus, and reclassifies
new questions when an application section changes. Required incomplete fields
stop automatic navigation. Final submission stays with you.

### Chrome extension

1. `npm run dev` — the extension needs the backend for the agent, research, and
   the policy layer. API keys never enter the extension.
2. Open `chrome://extensions`, enable **Developer mode**, choose
   **Load unpacked**, and select the `extension/` folder.
3. Visit any job application page. A collapsed SCREENMATE pill appears when the
   page looks like an application form; click it to open the panel.
4. Click the toolbar icon to edit your profile or point the extension at a
   different backend URL.

Auto-detection requires at least two fields, a name or email question, and
application-related fields or wizard context. It watches for application dialogs
that appear after load. Ordinary login forms do not qualify.

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

Written answers use plain language, concrete evidence from your profile and the
specific employer's role. The requested format and length take precedence over
a fixed writing style. URLs, date ranges and punctuation are preserved.

## Tech

Next.js · React · TypeScript · Tailwind CSS · OpenRouter · Exa.ai

## Hackathon

Built during **AI Tinkerers — Agents, Everywhere**, 2026.
