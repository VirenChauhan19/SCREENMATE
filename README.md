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

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in the two keys
npm run dev
```

### Multi-step applications

Real applications are wizards. SCREENMATE fills a step, verifies every write,
clicks **Next**, re-scans the new step, and keeps going — up to 8 steps.

It will **never** click Submit. That is enforced in `nav.js`, not left to the
model, because a submitted application cannot be taken back. Anything matching
submit / apply now / finish / confirm and… / agree and… is refused, and a button
reading "Submit and continue" is refused too. When no Next button remains, the
run stops and hands you the submit control explicitly.

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

### Chrome extension

1. `npm run dev` — the extension needs the backend for the agent, research, and
   the policy layer. API keys never enter the extension.
2. Open `chrome://extensions`, enable **Developer mode**, choose
   **Load unpacked**, and select the `extension/` folder.
3. Visit any job application page. A collapsed SCREENMATE pill appears when the
   page looks like an application form; click it to open the panel.
4. Click the toolbar icon to edit your profile or point the extension at a
   different backend URL.

Auto-detection is deliberately conservative: it needs at least four fields,
something name- or email-shaped, and either six-plus fields or a resume/cover
letter/experience question. A login box will not summon a panel.

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
