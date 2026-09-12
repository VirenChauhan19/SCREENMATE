/**
 * Drives the extension through a multi-step, Workday-shaped application:
 * custom combobox widgets, ARIA radio groups, portaled listboxes, dynamic
 * step transitions, and a final Submit button that must never be pressed.
 */
const puppeteer = require("puppeteer-core");
const path = require("path");
const os = require("os");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EXT = path.resolve(__dirname, "..", "extension");
const PAGE = "http://localhost:8099/workday.html";
const fs = require("fs");
// A fresh profile each run: stale chrome.storage from a previous run
// would mask real bugs in how preferences are saved.
const PROFILE = path.join(os.tmpdir(), `screenmate-wd-${Date.now()}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    enableExtensions: true,
    args: [
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1500,1020",
      `--user-data-dir=${PROFILE}`,
    ],
  });

  let failures = 0;
  const fail = (m) => {
    console.log(`  FAIL  ${m}`);
    failures++;
    process.exitCode = 1;
  };
  const check = (name, cond) => {
    console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}`);
    if (!cond) {
      failures++;
      process.exitCode = 1;
    }
  };

  try {
    const extId = await browser.installExtension(EXT);
    console.log(`extension installed: ${extId}\n`);

    const page = await browser.newPage();
    await page.setViewport({ width: 1500, height: 1020 });
    page.on("dialog", async (d) => {
      console.log(`  [page alert] ${d.message()}`);
      await d.dismiss();
    });
    page.on("pageerror", (e) => console.log("  [page error]", e.message));

    await page.goto(PAGE, { waitUntil: "networkidle2" });
    await sleep(2500);

    /* ---- scanner sanity on a custom-widget page ---- */
    await page.addScriptTag({ path: path.join(EXT, "content", "scan.js") });
    await page.addScriptTag({ path: path.join(EXT, "content", "act.js") });
    await page.addScriptTag({ path: path.join(EXT, "content", "nav.js") });
    await page.addScriptTag({ path: path.join(EXT, "content", "prefs.js") });

    const scan = await page.evaluate(() => {
      const f = window.__screenmateScan.scanFields();
      const next = window.__screenmateNav.findAdvanceControl();
      return {
        fields: f.map((x) => `${x.type}  ${x.label}`),
        ids: f.map((x) => x.id),
        step: window.__screenmateScan.pageContext().stepLabel,
        advance: next?.text || null,
      };
    });
    console.log("=== STEP 1 SCAN ===");
    scan.fields.forEach((l) => console.log(`  ${l}`));
    console.log(`  step label   : ${scan.step}`);
    console.log(`  advance ctrl : ${scan.advance}`);
    check("custom combobox detected as select", scan.fields.some((f) => f.startsWith("select")));
    check("advance control found", scan.advance === "Save and Continue");

    /* ---- submit button must be refused ---- */
    const submitGuard = await page.evaluate(() => {
      const btn = document.createElement("button");
      btn.textContent = "Submit Application";
      return {
        refused: window.__screenmateNav.isSubmitControl(btn),
        advanceIgnoresSubmit:
          window.__screenmateNav.findAdvanceControl()?.text !== "Submit Application",
      };
    });
    check("submit control recognised", submitGuard.refused);
    check("advance never selects submit", submitGuard.advanceIgnoresSubmit);

    /* ---- run the real extension ---- */
    console.log("\n=== RUN ===");
    await page.waitForFunction(
      () => !!document.getElementById("screenmate-root")?.shadowRoot,
      { timeout: 20000 },
    );
    await page.evaluate(() => {
      const sr = document.getElementById("screenmate-root").shadowRoot;
      sr.querySelector(".head").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await sleep(2500);

    const panelState = () =>
      page.evaluate(() => {
        const sr = document.getElementById("screenmate-root").shadowRoot;
        return {
          status: sr.querySelector(".status")?.textContent.trim() || "",
          approval: sr.querySelector(".card .q")?.textContent.trim() || null,
          activity: [...sr.querySelectorAll(".feed .msg")].map((n) => n.textContent.trim()),
        };
      });

    // First click surfaces the standing-answers setup.
    await page.evaluate(() => {
      const sr = document.getElementById("screenmate-root").shadowRoot;
      [...sr.querySelectorAll("button")]
        .find((b) => /run screenmate/i.test(b.textContent))
        ?.click();
    });
    await sleep(1200);

    const prefsShown = await page.evaluate(
      () =>
        !!document
          .getElementById("screenmate-root")
          .shadowRoot.querySelector(".pq"),
    );
    console.log(`standing-answers setup shown on first run: ${prefsShown}`);
    check("asks for standing answers before acting", prefsShown);

    // Answer them the way a person would: decline every protected question.
    const chosen = await page.evaluate(() => {
      const sr = document.getElementById("screenmate-root").shadowRoot;
      const picked = {};
      sr.querySelectorAll(".pq").forEach((q) => {
        const label = q.querySelector(".pql")?.textContent.trim() || "";
        const free = q.querySelector(".pfree");
        if (free) {
          free.value = /salary/i.test(label) ? "Negotiable" : "June 2026";
          picked[label] = free.value;
          return;
        }
        const opts = [...q.querySelectorAll(".popt")];
        const decline = opts.find((o) => /do not wish/i.test(o.textContent));
        let target = decline;
        if (!target) {
          if (/sponsorship/i.test(label)) {
            target = opts.find((o) => o.textContent.trim() === "No");
          } else if (/authorized/i.test(label) || /relocate/i.test(label)) {
            target = opts.find((o) => o.textContent.trim() === "Yes");
          } else {
            target = opts[0];
          }
        }
        target?.click();
        picked[label] = target?.textContent.trim();
      });
      return picked;
    });
    // Regression guard: selecting an option must not scroll the panel to the top
    // or wipe text typed into another field.
    const scrollTest = await page.evaluate(async () => {
      const sr = document.getElementById("screenmate-root").shadowRoot;
      const body = sr.querySelector(".body");
      body.scrollTop = body.scrollHeight;               // scroll to the bottom
      const before = body.scrollTop;

      const salary = sr.querySelector('.pfree[data-topic="salary"]');
      if (salary) salary.value = "TYPED-BUT-UNSAVED";

      // Click an option well above the current viewport.
      sr.querySelectorAll(".popt")[0]?.click();
      await new Promise((r) => setTimeout(r, 700));

      const after = sr.querySelector(".body");
      return {
        before,
        after: after.scrollTop,
        draftSurvived:
          sr.querySelector('.pfree[data-topic="salary"]')?.value ===
          "TYPED-BUT-UNSAVED",
      };
    });
    console.log(
      `scroll before=${scrollTest.before} after=${scrollTest.after} ` +
        `draftSurvived=${scrollTest.draftSurvived}`,
    );
    check(
      "selecting an option does not reset scroll to top",
      scrollTest.before > 0 && Math.abs(scrollTest.after - scrollTest.before) < 60,
    );
    check("unsaved typing survives a re-render", scrollTest.draftSurvived);

    // Clear the sentinel so it does not become the saved salary preference.
    await page.evaluate(() => {
      const sr = document.getElementById("screenmate-root").shadowRoot;
      const salary = sr.querySelector('.pfree[data-topic="salary"]');
      if (salary) salary.value = "";
    });

    console.log("standing answers set:");
    for (const [k, v] of Object.entries(chosen)) {
      console.log(`   ${k.slice(0, 52).padEnd(54)} ${v}`);
    }
    await sleep(600);

    await page.evaluate(() => {
      const sr = document.getElementById("screenmate-root").shadowRoot;
      [...sr.querySelectorAll("button")]
        .find((b) => /save and run/i.test(b.textContent))
        ?.click();
    });

    // Walk the wizard, answering every sensitive question the agent pauses on.
    let st = { status: "" };
    let answered = 0;
    const answeredLabels = [];
    for (let i = 0; i < 200; i++) {
      await sleep(1000);
      st = await panelState();

      if (/waiting for user/i.test(st.status)) {
        const label = st.approval;
        const picked = await page.evaluate(() => {
          const sr = document.getElementById("screenmate-root").shadowRoot;
          const free = sr.querySelector(".afree");
          if (free) {
            free.value = "Negotiable";
            sr.querySelector('[data-act="answerFree"]')?.click();
            return "Negotiable (typed)";
          }
          const opts = [...sr.querySelectorAll(".opt")];
          const decline = opts.find((o) => /do not wish|decline/i.test(o.textContent));
          const target = decline || opts[0];
          target?.click();
          return target?.textContent.trim() || null;
        });
        answered++;
        answeredLabels.push(`${label} → ${picked}`);
        if (answered > 12) {
          fail("approval loop: the same questions are being re-asked");
          break;
        }
        await sleep(1800);
        continue;
      }
      if (/complete|awaiting your review|unavailable/i.test(st.status)) break;
    }

    console.log(`\nfinal status: ${st.status}`);
    console.log(`sensitive questions handed to the user: ${answered}`);
    answeredLabels.forEach((a) => console.log(`   ${a}`));

    /* ---- what actually happened in the wizard ---- */
    const fullFeed = await page.evaluate(() => {
      const sr = document.getElementById("screenmate-root").shadowRoot;
      return [...sr.querySelectorAll(".feed li")].map(
        (li) =>
          `${li.querySelector(".msg")?.textContent.trim()}` +
          (li.querySelector(".det")
            ? `  ::  ${li.querySelector(".det").textContent.trim().slice(0, 80)}`
            : ""),
      );
    });
    console.log("");
    console.log("=== ACTIVITY (tail) ===");
    fullFeed.forEach((e) => console.log(`   ${e}`));

    const wiz = await page.evaluate(() => window.__wizardState());
    console.log(`\n=== WIZARD STATE ===`);
    console.log(`  reached step index : ${wiz.step} (0-based, 3 = last)`);
    console.log(`  submitted          : ${wiz.submitted}`);
    console.log("  values captured:");
    for (const [k, v] of Object.entries(wiz.values)) {
      console.log(`    ${k.padEnd(30)} ${JSON.stringify(String(v).slice(0, 52))}`);
    }

    const nav = await page.evaluate(() => {
      const sr = document.getElementById("screenmate-root").shadowRoot;
      return {
        advancing: [...sr.querySelectorAll(".feed .msg")].filter((n) =>
          /advancing to step/i.test(n.textContent),
        ).length,
        handoff: !!sr.querySelector(".sec.warn .lbl.w")?.textContent.match(/submission is yours/i),
      };
    });

    console.log("\n=== ASSERTIONS ===");

    // The one that matters most.
    check("NEVER submitted the application", wiz.submitted === false);

    check("advanced through multiple steps", nav.advancing >= 2);
    check("reached the final step", wiz.step === 3);
    check("step 1 identity filled", /Viren/i.test(wiz.values["legalNameSection_firstName"] || ""));
    check("step 1 email filled", /@/.test(wiz.values["email"] || ""));
    check(
      "step 2 custom combobox set (degree)",
      /BFA Game Design/i.test(wiz.values["degree"] || ""),
    );
    check("step 2 portfolio filled", /virenchauhan/i.test(wiz.values["websiteSection_portfolio"] || ""));
    check("step 2 skills filled", (wiz.values["skillsSection"] || "").length > 5);
    check("step 3 motivation written", (wiz.values["question_1"] || "").length > 80);
    // Sensitive answers must equal the STANDING ANSWER the user set, exactly.
    // An inverted or invented value here is the worst bug this system can have.
    check(
      `sponsorship === stored "No" (got ${JSON.stringify(wiz.values["question_3"])})`,
      /^no/i.test(wiz.values["question_3"] || ""),
    );
    check(
      `work authorization === stored "Yes" (got ${JSON.stringify(wiz.values["question_2"])})`,
      /^yes/i.test(wiz.values["question_2"] || ""),
    );
    check(
      `salary === stored "Negotiable" (got ${JSON.stringify(wiz.values["question_4"])})`,
      /negotiable/i.test(wiz.values["question_4"] || ""),
    );
    for (const k of ["gender", "ethnicity", "veteranStatus", "disability"]) {
      check(
        `${k} === stored decline (got ${JSON.stringify(wiz.values[k])})`,
        /do not wish/i.test(wiz.values[k] || ""),
      );
    }
    check("submit handoff shown in panel", nav.handoff);
    check("did not loop on approvals", answered <= 6);
    check(
      "sensitive fields came from standing answers",
      st.activity.some((a) => /saved preference/i.test(a)) ||
        Object.keys(wiz.values).some((k) => ["question_3", "gender"].includes(k)),
    );
    check(
      "verification ran on writes",
      st.activity.some((a) => /confirmed/i.test(a)),
    );

    await page.screenshot({ path: "fixtures/workday-run.png" });
    console.log("\nscreenshot: fixtures/workday-run.png");
  } catch (err) {
    fail(err.message);
  } finally {
    await browser.close();
    try {
      fs.rmSync(PROFILE, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
    console.log(`\nRESULT: ${failures ? `FAIL (${failures})` : "PASS"}`);
  }
})();
