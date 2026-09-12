/**
 * Loads the unpacked extension into real Chrome, opens the fixture job form on a
 * different origin than the backend, runs SCREENMATE, and asserts the outcome.
 */
const puppeteer = require("puppeteer-core");
const path = require("path");
const os = require("os");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EXT = path.resolve(__dirname, "..", "extension");
const PAGE = "http://localhost:8099/apply.html";
// A dedicated profile dir so this never touches — or is blocked by — your own Chrome.
const fs = require("fs");
// A fresh profile each run: stale chrome.storage from a previous run
// would mask real bugs in how preferences are saved.
const PROFILE = path.join(os.tmpdir(), `screenmate-ext-${Date.now()}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    // Chrome 137+ gates --load-extension behind this feature flag.
    enableExtensions: true,
    args: [
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1500,1000",
      `--user-data-dir=${PROFILE}`,
    ],
  });

  const fail = (m) => {
    console.log("FAIL:", m);
    process.exitCode = 1;
  };

  try {
    // Chrome 137+ gates --load-extension, so install through the DevTools API.
    const extId = await browser.installExtension(EXT);
    console.log(`extension installed: ${extId}`);

    // Confirm Chrome actually accepted the unpacked extension.
    let swLoaded = false;
    for (let i = 0; i < 20 && !swLoaded; i++) {
      await sleep(500);
      swLoaded = browser
        .targets()
        .some(
          (t) =>
            t.url().startsWith("chrome-extension://") &&
            (t.type() === "service_worker" || t.type() === "background_page"),
        );
    }
    const targets = browser.targets().map((t) => `${t.type()} ${t.url()}`);
    console.log(`extension service worker loaded: ${swLoaded}`);
    if (!swLoaded) {
      console.log("  targets:", targets.join(" | ") || "(none)");
      fail("Chrome did not load the unpacked extension — check manifest validity");
    }

    const page = await browser.newPage();
    await page.setViewport({ width: 1500, height: 1000 });
    page.on("pageerror", (e) => console.log("  [page error]", e.message));
    page.on("console", (m) => {
      const t = m.text();
      if (/screenmate|error/i.test(t)) console.log("  [console]", t.slice(0, 160));
    });

    await page.goto(PAGE, { waitUntil: "networkidle2" });
    await sleep(2500);

    // Content scripts run in an isolated world, so page.evaluate cannot see
    // their globals. Load the same two files into the page world to exercise
    // the scanner and writer directly; the panel below tests the real thing.
    await page.addScriptTag({ path: path.join(EXT, "content", "scan.js") });
    await page.addScriptTag({ path: path.join(EXT, "content", "act.js") });

    /* ---- 1. scanner ---- */
    const scan = await page.evaluate(() => {
      const f = window.__screenmateScan.scanFields();
      return {
        count: f.length,
        ids: f.map((x) => x.id),
        labels: f.map((x) => x.label),
        types: f.map((x) => x.type),
        ctx: window.__screenmateScan.pageContext(),
      };
    });

    console.log("=== SCAN ===");
    console.log(`fields found: ${scan.count}`);
    scan.labels.forEach((l, i) =>
      console.log(`  ${scan.types[i].padEnd(9)} ${l.slice(0, 52)}`),
    );
    console.log(`company: ${scan.ctx.company}`);
    console.log(`title  : ${scan.ctx.jobTitle}`);
    console.log(`desc   : ${scan.ctx.jobDescription.slice(0, 90)}…`);

    if (scan.ids.some((i) => /password|csrf/i.test(i))) {
      fail("scanner picked up a hidden/password field");
    }
    if (scan.count < 11) fail(`expected >= 11 fields, got ${scan.count}`);

    /* ---- 2. the React-controlled input ---- */
    const react = await page.evaluate(() => {
      const el = document.getElementById("skills-react");
      const naive = (() => {
        el.value = "NAIVE";
        return el.value;
      })();
      const field = window.__screenmateScan
        .scanFields()
        .find((f) => f.id.includes("88215"));
      const mirrorAfterNaive = document.getElementById("skills-mirror").textContent;
      const res = window.__screenmateAct.applyWrite(field, "React, TypeScript");
      const verify = window.__screenmateAct.verifyWrite(field, "React, TypeScript");
      return {
        naive,
        mirrorAfterNaive,
        written: res.ok,
        after: el.value,
        verified: verify.ok,
      };
    });
    console.log("\n=== REACT-CONTROLLED INPUT ===");
    console.log(`  naive .value wrote the DOM node : ${react.naive === "NAIVE"}`);
    console.log(`  ...but React state saw it       : ${react.mirrorAfterNaive === "NAIVE"}  <- must be false`);
    console.log(`  native-setter write ok          : ${react.written}`);
    console.log(`  value after write               : "${react.after}"`);
    console.log(`  verification passed             : ${react.verified}`);

    // Read React's own state, not the DOM node, to prove the write landed.
    const mirror = await page.evaluate(
      () => document.getElementById("skills-mirror").textContent,
    );
    console.log(`  React state after our write     : "${mirror}"  <- proves it reached React`);
    if (react.mirrorAfterNaive === "NAIVE") {
      fail("fixture is not actually React-controlled; test is not meaningful");
    }
    if (!react.verified) fail("native setter write did not stick on React input");
    if (mirror !== "React, TypeScript") fail("write never reached React state");

    await page.evaluate(() => {
      const f = window.__screenmateScan
        .scanFields()
        .find((x) => x.id.includes("88215"));
      window.__screenmateAct.applyWrite(f, "");
    });

    /* ---- 3. the real extension: auto-mounted pill, then expand ---- */
    console.log("\n=== EXTENSION PANEL ===");
    await page.waitForFunction(
      () => !!document.getElementById("screenmate-root")?.shadowRoot,
      { timeout: 20000 },
    );
    const pill = await page.evaluate(() => {
      const sr = document.getElementById("screenmate-root").shadowRoot;
      return {
        collapsed: sr.querySelector(".root").classList.contains("collapsed"),
        text: sr.querySelector(".head").textContent.replace(/\s+/g, " ").trim(),
      };
    });
    console.log(`auto-mounted collapsed: ${pill.collapsed}`);
    console.log(`pill reads: "${pill.text}"`);
    if (!pill.collapsed) fail("panel should auto-mount collapsed");

    // Expand it the way a user would.
    await page.evaluate(() => {
      const sr = document.getElementById("screenmate-root").shadowRoot;
      sr.querySelector(".head").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await sleep(3000);

    const clickPanel = (label) =>
      page.evaluate((lbl) => {
        const sr = document.getElementById("screenmate-root").shadowRoot;
        const btn = [...sr.querySelectorAll("button")].find((b) =>
          b.textContent.trim().toLowerCase().includes(lbl),
        );
        if (btn) btn.click();
        return !!btn;
      }, label);

    const panelState = () =>
      page.evaluate(() => {
        const sr = document.getElementById("screenmate-root").shadowRoot;
        return {
          status: sr.querySelector(".status")?.textContent.trim(),
          approval: sr.querySelector(".card .q")?.textContent.trim() || null,
          activity: [...sr.querySelectorAll(".feed .msg")].map((n) =>
            n.textContent.trim(),
          ),
          plan: [...sr.querySelectorAll(".plan li")].map((n) =>
            n.textContent.trim(),
          ),
        };
      });

    if (!(await clickPanel("run screenmate"))) throw new Error("no Run button");
    await sleep(1200);

    // This suite deliberately exercises the OTHER branch: every standing answer
    // left as "Ask each time", so the run must still stop and ask.
    const gated = await page.evaluate(() => {
      const sr = document.getElementById("screenmate-root").shadowRoot;
      const qs = [...sr.querySelectorAll(".pq")];
      qs.forEach((q) => q.querySelector(".pask")?.click());
      return qs.length;
    });
    if (gated) {
      console.log(`standing answers: ${gated} questions set to "Ask each time"`);
      await sleep(900);
      await page.evaluate(() => {
        const sr = document.getElementById("screenmate-root").shadowRoot;
        [...sr.querySelectorAll("button")]
          .find((b) => /save and run/i.test(b.textContent))
          ?.click();
      });
    }

    // Wait for the agent to reach a decision point.
    let st;
    for (let i = 0; i < 90; i++) {
      await sleep(1000);
      st = await panelState();
      if (/waiting for user|complete|unavailable/i.test(st.status || "")) break;
    }

    console.log(`\nstatus: ${st.status}`);
    console.log("plan:");
    st.plan.forEach((p) => console.log(`   ${p}`));
    console.log("activity:");
    st.activity.forEach((a) => console.log(`   ${a}`));

    /* ---- 4. what landed in the real DOM ---- */
    const dom = await page.evaluate(() => ({
      name: document.getElementById("first_name").value,
      email: document.getElementById("em").value,
      loc: document.getElementById("loc").value,
      school: document.getElementById("sch").value,
      degree: document.getElementById("deg").value,
      grad: document.getElementById("grad").value,
      folio: document.getElementById("folio").value,
      li: document.getElementById("li").value,
      skills: document.getElementById("skills-react")?.value,
      why: document.getElementById("why").value,
      sponsorship: document.getElementById("spon").value,
      salary: document.getElementById("sal").value,
      veteran: [...document.querySelectorAll('input[name=veteran]')].filter(
        (r) => r.checked,
      ).length,
    }));

    console.log("\n=== DOM AFTER RUN ===");
    for (const [k, v] of Object.entries(dom)) {
      console.log(`  ${k.padEnd(12)} ${JSON.stringify(String(v).slice(0, 56))}`);
    }

    /* ---- 5. assertions ---- */
    console.log("\n=== ASSERTIONS ===");
    const check = (name, cond) => {
      console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}`);
      if (!cond) fail(name);
    };

    check("sponsorship left empty (sensitive)", dom.sponsorship === "");
    check("salary left empty (sensitive)", dom.salary === "");
    check("veteran left unanswered (sensitive)", dom.veteran === 0);
    check("portfolio filled", /virenchauhan/.test(dom.folio));
    check("location filled", /Atlanta/i.test(dom.loc));
    check("react skills field filled", (dom.skills || "").length > 3);
    check("motivation written", (dom.why || "").length > 80);
    check("agent stopped for approval", /waiting for user/i.test(st.status || ""));
    check(
      "verification lines present",
      st.activity.some((a) => /confirmed/i.test(a)),
    );

    /* ---- 6. answer the sensitive question ---- */
    if (/waiting for user/i.test(st.status || "")) {
      console.log(`\napproval shown: "${st.approval}"`);
      await page.evaluate(() => {
        const sr = document.getElementById("screenmate-root").shadowRoot;
        const btn = [...sr.querySelectorAll(".opt")].find(
          (b) => b.textContent.trim() === "No",
        );
        btn?.click();
      });
      await sleep(2500);
      const after = await page.evaluate(
        () => document.getElementById("spon").value,
      );
      check("user answer landed in the DOM", after === "No");
      console.log(`  sponsorship now: "${after}"`);
    }

    await page.screenshot({ path: "fixtures/extension-run.png", fullPage: false });
    console.log("\nscreenshot: fixtures/extension-run.png");
  } catch (err) {
    fail(err.message);
  } finally {
    await browser.close();
    try {
      fs.rmSync(PROFILE, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
    console.log(
      `\nRESULT: ${process.exitCode ? "FAIL" : "PASS"}`,
    );
  }
})();
