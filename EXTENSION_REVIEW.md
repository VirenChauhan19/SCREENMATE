# SCREENMATE extension review — September 24, 2026

The core backend workflow works, but this version is not ready to be trusted on arbitrary live applications. This was a review of the current working tree, including its pre-existing uncommitted changes. No application code was changed, deployed, or published.

Follow-up: the subsequent UI task changed local code and added browser-tested fixes. See [UI test results](fixtures/ui/README.md). The findings below describe the earlier snapshot; submission confirmation and ordinary-text verification have since received targeted fixes. Other findings remain open, and no deployment was performed.

## Checks completed

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run build` | Passed, Next.js 15.5.25 |
| Parse every extension JavaScript file | All 11 passed |
| `npm run e2e` against the local production server with real model/research services | Passed: 7 verified writes, 0 verification failures, 8 validation checks passed, 12/12 fields populated after simulated user answers |
| Bundled hosted backend `/api/health` | HTTP 200; model and research keys configured |
| Hosted `/api/classify`, valid bundled key | HTTP 200; email safe, sponsorship sensitive |
| Hosted authentication probe, no key | HTTP 401 normally; HTTP 200 with a same-origin `Origin` header |
| `npm run lint` | Did not lint: interactive ESLint setup prompt, configuration missing |
| Focused Node reproductions using the extension's actual functions | Confirmed defects below; DOM-dependent functions used small mock elements, not a live browser |

The API E2E test operates on application state, not an installed extension. Its pass does not establish Chrome injection, controlled-widget writes, resume upload, wizard persistence, or submission behavior on employer sites.

## Findings, ordered by priority

1. **High: panel actions do not authenticate user clicks.** `extension/content/panel.js:243` creates an open shadow root; `bind()` at line 874 accepts synthetic events, and `submitGo` at line 926 invokes `onSubmit` without checking either `event.isTrusted` or an armed confirmation state. Calling the actual bound listener with `isTrusted: false` and `confirmSubmit: false` invoked the submission callback in a Node reproduction. Host-page scripts can reach the open panel DOM, so the two displayed buttons are not a reliable human-approval boundary. This also affects answers and stored preferences. Use trusted-event checks for consequential actions, explicit confirmation state, and preferably an extension-owned confirmation surface. Browser-level exploitation was not performed.

   Chrome isolates JavaScript variables, while content scripts still operate on page DOM; isolation alone does not protect the panel controls. See [Chrome content-script documentation](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts).

2. **High: the production access-key gate is bypassable.** `src/lib/auth.ts:67` trusts a matching `Origin` header. Confirmed on the configured deployment: a keyless classify request returned 401; adding its own origin returned 200. The model and CV/research routes use the same gate, so the shared key does not adequately protect paid services. Remove the origin-only authentication exception and authenticate demo users separately; enforce rate limits. The probe used only classification, not paid calls through the bypass.

3. **High: stored sensitive answers can mean the opposite on another site.** `extension/content/prefs.js:168` resolves by topic and answer text without considering question polarity. The hosted classifier assigns `sponsorship` to “Can you work without employer sponsorship?”; a saved sponsorship answer “No” then resolves to “No” for that question, although its meaning is reversed. Compound relocation questions also need fresh confirmation rather than blind topic reuse. Separately, `matchOption('No', ['No preference', 'Yes', 'No, I cannot relocate'])` returns `No preference`, because the prefix branch runs before the negative-answer safeguards. Re-ask ambiguous or inverted questions and match explicit semantic choices conservatively.

4. **High: write verification accepts truncated text.** `extension/content/act.js:624` accepts either value as a prefix of the other for ordinary text fields. The actual `verifyWrite` returned `ok: true` and “Field update confirmed” when the expected name was `Jonathan` and the mock input held `Jo`. A site that truncates or partially rejects a write can be reported as successful. Require exact normalized text for ordinary fields; restrict any formatting tolerance to specific widget types.

5. **Medium: location grounding ignores state/country.** `src/lib/grounding.ts:52` compares only text before the first comma. The actual function accepted `Portland, Maine` from a profile containing `Portland, Oregon`. This can authorize incorrect location data. Allow known abbreviations while retaining state/country identity; otherwise ask the user.

6. **Medium: resume parsing cannot populate all displayed profile fields.** `src/app/api/parse-cv/route.ts:16` and its response omit `country`, `currentCompany`, and `currentTitle`, although extension settings expose them. Those values require manual entry even when the resume contains them. Add extraction and validation if automatic profile setup is intended to cover those fields.

7. **Medium: validation scripts can give false confidence.** `scripts/e2e.ts:183` prints FAIL without setting a nonzero exit code for incomplete outcomes, and its result condition does not include the verification-failure counter. In addition, lint currently opens setup instead of checking code. Make failed assertions fail the process and configure a noninteractive linter.

## Live-site evidence and limits

- Inspected a current [Cloudflare Greenhouse application](https://boards.greenhouse.io/cloudflare/jobs/8212352?gh_jid=8212352). It exposes normal identity fields, custom country/location widgets, resume upload, sensitive choices, a privacy acknowledgement, and a final submit button. This confirms a relevant real-world form exists; it does not prove SCREENMATE completed it.
- The Cloudflare URL embedded in `scripts/real-sites-probe.js` redirected to the careers listing instead of its old application. Live probes need current job links and assertions for expected form presence.
- Chrome's extension-management page was blocked by the browser tool's URL security policy. Installed-version inspection and fresh-install browser tests were not completed. No alternative extension-installation mechanism was used to bypass that restriction.
- No employer form was filled or submitted. Browser automation suites for the unpacked extension, CV popup, iframe/wizard runs, and recipient installation were not run in this review.
- The manifest targets HTTP(S) pages, excludes several domains, sets `match_about_blank: false`, and does not enable related-origin fallback. Embedded blank/data/blob frames therefore need separate compatibility work; see [Chrome frame-injection documentation](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts#injecting-in-related-frames).

Before release, fix findings 1–5 and run installed-extension tests on controlled fixtures covering text truncation, custom dropdowns, saved-answer ambiguity, resume uploads, full-page and iframe navigation, restart recovery, and trusted submission confirmation. Then perform supervised tests on current target ATS pages. The current evidence supports a functioning prototype, not universal live-site reliability.
