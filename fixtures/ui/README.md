# UI regression fixtures

Run `node scripts/ui-harness-server.js`, then open:

- `http://127.0.0.1:8101/` — the real extension panel with deterministic question, failure, review, and submission scenarios.
- `http://127.0.0.1:8101/integration` — the real scanner, writer, preferences, panel, and orchestration loop on a local application form. Click **Open test panel**. The srcdoc frame prevents a separately installed SCREENMATE version from overlaying this test instance.
- `http://127.0.0.1:8101/extension/options/options.html` — the real settings UI with fake Chrome storage.

These fixtures use synthetic data and a mocked Chrome transport. They do not exercise extension installation, host permissions, service-worker lifetime, CV parsing, or employer-side submissions. The server listens only on loopback and serves a fixed allowlist; it cannot serve `config.json` or credentials. Fixture storage is isolated from the installed extension.

Run `node --test scripts/ui-regressions.test.js` for repeatable regression checks of draft isolation, preference persistence, partial-write rejection, submission guards, and stale backend responses.

## Browser checks completed September 24, 2026

| Flow | Observed result |
| --- | --- |
| Type an answer, uncheck Remember, refresh activity, save | Exact draft saved with `remember=false` |
| Advance from phone to notice period | New question starts empty |
| Select from a long dropdown, refresh activity | Selection remains selected |
| Fail a write and retry | Question remains open; retry saves the original draft and Remember choice |
| Type salary, choose Ask each time, save | Saved value is `__ask__`, not the old salary |
| Edit a reviewed field, refresh activity, save | Edited text survives and is saved |
| Synthetic submit clicks | No submission callback |
| Submit, cancel, then submit and confirm | Cancel does not submit; deliberate confirmation invokes callback once |
| Full local orchestration | Setup defaults save; identity fills; questions show remaining count and required/optional status |
| Skip required notice period, answer sponsorship, skip optional salary | Submit disabled; Answer remaining questions reopens notice period |
| Answer the missing notice period | Answer verifies, review resumes, submission control becomes available |
| Confirm submission on the local form | Fixture receives submission and the panel reports the site's confirmation |
| Submitted review screen | Shows submitted answers and removes edit controls |
| Invalid backend URL | Actionable error shown; invalid URL is not saved |
| Web app with real model/research APIs | Both approval questions transition to review |
| Web app Finish review before accepting | Disabled |
| Accept all seven changes individually, finish | Application ready; no pending review check |
| Web app Review application | Review reopens with accepted changes |

`npm run typecheck`, `npm run build`, and the five Node regression tests passed after the UI fixes. Existing changes in the checkout were preserved. The earlier security/compatibility review remains relevant: this UI pass is not a claim of universal live-site support.
