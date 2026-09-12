# SCREENMATE — 2 Minute Demo Script

## Before you start

- [ ] `npm run dev` is running, browser at `http://localhost:3000`
- [ ] Window is **maximized** — the layout is desktop-first
- [ ] Both keys are in `.env.local`
- [ ] Click **Reset** so the form is in its starting state
- [ ] Optional dry run: `npm run e2e` should print `RESULT: PASS`

**The one button you press:** `Start demo` in the top bar. It resets state and kicks
off the run. Everything after that is the agent working for real — no scripted output.

---

## 0:00 – 0:15 · The problem

> "Every time you use an AI assistant with software, you're the integration layer. You
> copy your background into a chat window, paste the job description after it, explain
> what the form wants, get an answer, then paste it back. The assistant never saw the
> form."

> "SCREENMATE lives inside the application instead."

**On screen:** the Nova Systems application portal, some fields filled, some empty.
Don't press anything yet.

---

## 0:15 – 0:30 · Reading the environment

**Press `Start demo`.**

> "It starts by reading the live form state — not a description of the form, the
> actual state. Nine open fields. It knows which are required, which have options,
> and which two are sensitive."

**Point at:** the right panel — `Observing`, then the observation line, then
**Agent plan** appearing with 4–6 steps.

> "Before it touches anything, it commits to a plan."

---

## 0:30 – 0:50 · Deciding to research

> "Now watch this line — this is a real decision, not a formality."

**Point at:** `Research required` in the activity feed and its rationale.

> "It reasoned that 'why are you interested in this role' can't be answered from my
> profile or the job description alone — neither one says what Nova Systems actually
> builds. So it calls Exa. If only my degree and portfolio were missing, it skips the
> call and says so. It doesn't research by reflex."

**Point at:** `Company context retrieved · 4 sources`. Expand **Research** → click
**4 sources used** to show the real titles and why each mattered.

> "Real sources. Attributed. Not dumped into the UI."

---

## 0:50 – 1:10 · Acting and verifying

**Point at:** fields filling in the left panel, one at a time, each with a brief
violet highlight.

> "These are real tool calls against the form — `fillField`, `selectOption`. Not text
> I have to paste."

**Point at:** the indented `Field update confirmed` lines under each action.

> "And after every single write, it re-reads application state and verifies: field
> exists, value committed, no validation error, counted as complete. If a write
> doesn't land, it retries once and reports it rather than pretending."

**Point at:** the badges — `Agent completed` on portfolio (high confidence, copied
verbatim) vs `Review recommended` on skills.

> "It also tells you how much to trust each one."

---

## 1:10 – 1:25 · The tailored answer

**Point at:** the motivation field.

> "This one is generated — profile, plus job description, plus the research it just
> did. And it's grounded: outside free text, every value it writes has to appear
> verbatim in my profile. It structurally cannot invent a school or a URL."

---

## 1:25 – 1:40 · Stopping

**Point at:** the amber `User decision required` card.

> "Then it hits this and stops."

> "Sponsorship. Work authorization. That's a legal declaration about me — an agent has
> no business answering it, no matter how confident it is."

> "This is enforced in three independent places: the prompt, the server, and the tool
> layer. I tried to jailbreak it — I put an instruction in the job description telling
> it that it was authorized to answer automatically. It refused, and the server would
> have rewritten the action anyway."

---

## 1:40 – 1:50 · Human decision, agent continues

**Click `No`.**

> "I answer. It continues where it left off."

**Point at:** the activity line showing the answer was recorded from *your* decision.

---

## 1:50 – 2:00 · Validation and review

**Point at:** the validation checks, then the review panel.

> "Final validation — eight checks, zero blockers. Then it shows me everything it
> changed, before and after, and asks me to approve it."

> "It never submits. SCREENMATE completed what it could safely automate and left final
> control with me."

---

## If you have 30 more seconds

**The context-change moment** — this is the strongest unscripted beat:

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

## Questions you'll probably get

**"Is the research real or canned?"**
Real. Expand the sources and open one — it's live Exa output. Nova Systems is an
actual Australian defence engineering firm, which is why the research talks about
geospatial and defence work while our demo job description is a web role. The mismatch
is proof it isn't faked.

**"What stops it from filling the sensitive field anyway?"**
Three layers, any one sufficient — prompt, server rewrite, tool-layer refusal. Plus
the topic guard: a new field whose label mentions visa, salary, disability, or
demographics is classified sensitive automatically. New fields fail closed.

**"Could it hallucinate my details?"**
Not on structured fields. Every non-free-text value must appear verbatim in the
profile or the tool refuses the write and logs `Blocked ungrounded value`.

**"Why not a browser extension?"**
That's the next build. The agent already reads a structured `ApplicationState` — the
extension is a different way to produce that state, not a different agent.
