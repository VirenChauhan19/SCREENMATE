# SCREENMATE — 2 Minute Demo Script

## Before you start

**Primary demo: the Chrome extension on a real job posting.**
**Backup: the Next.js portal in a second tab.** Have both ready.

- [ ] `npm run dev` is running (the extension needs it for agent, research, policy)
- [ ] Extension loaded: `chrome://extensions` → Developer mode → Load unpacked → `extension/`
- [ ] Toolbar icon → your profile is filled in → **Backend reachable** shows green
- [ ] **Standing answers set** — open the panel once and answer the setup card.
      Do this BEFORE the demo; you do not want to fill it on stage.
- [ ] A real job application page open in tab 1 — pick one and **test it before you
      present**. Greenhouse, Lever and Ashby forms scan reliably; Workday does not.
- [ ] `http://localhost:3000` open in tab 2 as the fallback
- [ ] Window **maximized**
- [ ] Dry runs, both green:
      `npm run e2e` → `RESULT: PASS`
      `npm run fixture:serve` + `npm run ext:e2e` → `RESULT: PASS`

**If the live site misbehaves, switch to tab 2 and keep talking.** The portal demo
is the same agent; nothing in your script changes except the surface.

---

## 0:00 – 0:15 · The problem

> "Every time you use an AI assistant with software, you're the integration layer. You
> copy your background into a chat window, paste the job description after it, explain
> what the form wants, get an answer, then paste it back. The assistant never saw the
> form."

> "SCREENMATE lives inside the application instead."

**On screen:** a real job application page, untouched. Don't press anything yet.
Point out the small SCREENMATE pill that appeared by itself in the corner —
it detected this page is an application form.

---

## 0:15 – 0:30 · Reading the environment

**Click the pill to open the panel.**

> "It reads the live DOM of a page it has never seen — not a description of the
> form, the actual form. It resolves every label, works out which fields are
> required, which have fixed options, and which ones it isn't allowed to touch."

> "That classification doesn't happen in the extension. It sends what it found to
> the server and the server decides. One copy of the safety rules, and if the
> backend is unreachable the extension refuses to act at all."

**Point at:** the right panel — `Observing`, then the observation line, then
**Agent plan** appearing with 4–6 steps.

> "Before it touches anything, it commits to a plan."

---

## 0:30 – 0:50 · Deciding to research

> "Now watch this line — this is a real decision, not a formality."

**Point at:** `Research required` in the activity feed and its rationale.

> "It reasoned that 'why do you want to work here' can't be answered from my profile
> or the posting alone — neither one says what this company actually builds today. So
> it calls Exa. If only my degree and portfolio were missing, it skips the call and
> says so. It doesn't research by reflex."

**Point at:** `Company context retrieved · N sources`. Expand **Research** → click
**N sources used** to show the real titles and why each mattered.

> "Real sources. Attributed. Not dumped into the UI."

---

## 0:50 – 1:10 · Acting and verifying

**Point at:** fields filling in on the real page, one at a time, each with a brief
violet highlight.

> "These are real tool calls writing into someone else's form — `fillField`,
> `selectOption`. Not text I have to paste."

> "And they go through the native value setter plus the events a framework listens
> for. If you just assign `.value` on a React-controlled input, the box looks right
> and the app never hears about it. That's a bug that ships silently — which is
> exactly why the next part matters."

**Point at:** the indented `Field update confirmed` lines under each action.

> "After every single write it re-reads the page and verifies: element still there,
> value actually committed, field non-empty, no validation error raised. If a write
> doesn't land it retries once, then reports the failure rather than pretending."

> "That check is what catches the React problem I just mentioned — it's checking the
> page, not its own optimism."

---

## 1:10 – 1:25 · The tailored answer

**Point at:** the motivation field.

> "This one is generated — profile, plus the posting, plus the research it just did.
> Everything else is grounded: outside free text, every value it writes must appear
> verbatim in my profile, checked server-side before the plan ever reaches the page.
> It structurally cannot invent a school, a date, or a URL."

---

## New beat · It walks the whole wizard

**Point at:** the step pips in the panel and the page changing under it.

> "Real applications are multi-step. It fills a step, verifies every write, clicks
> Next, re-reads the new page, and keeps going."

> "It set that dropdown too — and that's not a `<select>`. It's a button that opens
> a floating listbox, which is what Workday and most modern ATS systems use. You
> can't write to those. You have to operate them."

**Point at:** the sensitive fields filling with *your* answers.

> "These come from standing answers I set once. It's still not deciding anything —
> it's transcribing a decision I already made, and it says so on every line."

---

## 1:25 – 1:40 · Stopping

**Point at:** the amber `User decision required` card, and at the sponsorship,
salary and veteran-status fields still sitting empty on the page.

> "Then it hits these and stops. Sponsorship. Desired salary. Veteran status."

> "Note it has never seen this form before. Those fields have machine-generated ids
> like `question_88217` — nothing to pattern-match on. It classified them from the
> label text alone, and anything touching visa, salary, disability or demographics
> fails closed by default. A field it doesn't understand is a field it won't touch."

> "This is enforced in three independent places: the prompt, the server, and the tool
> layer. I tried to jailbreak it — I put an instruction in the job description telling
> it that it was authorized to answer automatically. It refused, and the server would
> have rewritten the action anyway."

**Point at:** the Submit button, still sitting there untouched.

> "And this is the line I care most about. It will click Next all day. It will never
> click Submit. That's not the model's judgement — it's a hard refusal in the
> navigation code, because a submitted application can't be taken back."

---

## 1:40 – 1:50 · Human decision, agent continues

**Click `No`.**

> "I answer. It continues where it left off."

**Point at:** the activity line showing the answer was recorded from *your* decision.

---

## 1:50 – 2:00 · Validation and review

**Point at:** the validation checks, then the review panel.

> "Final validation, then it shows me everything it changed, before and after, and
> asks me to approve it. Accept all, or revert all — the revert puts the page back
> exactly as it found it."

> "It never submits. SCREENMATE completed what it could safely automate and left final
> control with me."

---

## If you have 30 more seconds

**The context-change moment** (portal tab) — the strongest unscripted beat:

1. Clear the **Portfolio URL** field by hand.
2. The panel immediately shows `Context changed` with **Restore value** / **Leave it**.

> "The environment changed under the agent. It noticed, told me, and asked — instead
> of silently re-filling or carrying on with a stale plan. That's the difference
> between an agent reacting to an environment and a script running to completion."

**Or the role switch:**

1. Use the role dropdown in the top bar → switch to **Design Engineering Intern**.
2. Activity shows `Context updated` and `Previous company context invalidated`.

> "Different opening, so the research it gathered no longer applies. It throws it out
> rather than reusing stale context."

---

## Recovery

| If this happens | Do this |
|---|---|
| `Agent temporarily unavailable` | Click **Retry** in the panel. The form stays editable — say so out loud, it's the point. |
| `External research unavailable` | Keep going. The agent proceeds on the job description alone. Call it out as designed degradation. |
| Run feels slow | Don't wait in silence — narrate the plan panel while actions land. |
| Anything looks wrong | **Reset** in the top bar, then `Start demo` again. |
| Extension panel never appears | Click the toolbar icon → **Open on this page**. Auto-detect is deliberately conservative. |
| `Cannot classify fields` | The backend is down. `npm run dev`, then **Rescan page**. |
| Live site parses badly | Switch to the portal tab. Same agent, same script. |
| Wizard won't advance | Usually a required field the site blocks on. The panel says so. Fill it by hand and hit Run again. |
| It asks a question you already set | Your standing answer had no match in that site's options. Answer it and tick "Remember" — it learns the new wording. |

## Questions you'll probably get

**"Is the research real or canned?"**
Real. Expand the sources and open one — it's live Exa output on whatever company's
page you happen to be on. On the fallback portal demo the company is Nova Systems, a
real Australian defence engineering firm, which is why the research talks about
geospatial and defence work while that fictional posting is a web role. The mismatch
is itself proof it isn't faked.

**"What stops it from filling the sensitive field anyway?"**
Three layers, any one sufficient — prompt, server rewrite, tool-layer refusal. Plus
the topic guard: a new field whose label mentions visa, salary, disability, or
demographics is classified sensitive automatically. New fields fail closed.

**"Could it hallucinate my details?"**
Not on structured fields. Every non-free-text value must appear verbatim in the
profile or the tool refuses the write and logs `Blocked ungrounded value`.

**"Is this just autofill?"**
Autofill matches known field names to saved values. It can't write a tailored answer,
it doesn't research the company, it never verifies that a write landed, and it has no
concept of a question it shouldn't answer. Show the sponsorship pause — no autofill
does that.

**"Do my API keys sit in the extension?"**
No. The extension has no keys and no policy logic. Every call goes through the local
backend. That's also why it fails closed when the backend is down.

**"What happens on a form it can't parse?"**
It tells you it found nothing rather than guessing. There is no per-site code —
it reads native controls, ARIA widgets and open shadow roots, and falls back to
plain text rather than skipping a control it doesn't recognise. Verified against
fixtures built on the real DOM patterns of Greenhouse, Lever, Ashby, Workday and
iframe-embedded Taleo. A form drawn on a canvas, or hidden in a closed shadow
root, is out of reach.

**"Does it handle forms inside an iframe?"**
Yes, and that matters more than it sounds — Taleo, iCIMS and most embedded
Greenhouse/Lever forms live in one. The script runs in every frame, the frame
holding the form takes the panel, and the job description is read from the parent
page, because the iframe on its own knows nothing about the job.
