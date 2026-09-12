/**
 * Two things a person should never have to do twice:
 *   1. point the extension at a backend that is actually running
 *   2. upload their CV
 *
 * Both were broken. This holds them fixed.
 */
const puppeteer = require("puppeteer-core");
const path = require("path");
const os = require("os");
const fs = require("fs");

const CHROME = path.join(
  "C:",
  "Program Files",
  "Google",
  "Chrome",
  "Application",
  "chrome.exe",
);
const EXT = path.resolve(__dirname, "..", "extension");
const CV = path.resolve(__dirname, "..", "fixtures", "cv", "sample-cv.pdf");
const PROFILE = path.join(os.tmpdir(), `screenmate-persist-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let failures = 0;
  const check = (n, ok, d = "") => {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? ` - ${d}` : ""}`);
    if (!ok) failures++;
  };

  const bundled = (() => {
    const f = path.join(EXT, "config.json");
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
  })();

  if (!bundled?.backendUrl) {
    console.log("No extension/config.json — nothing to verify. Create one first.");
    process.exitCode = 1;
    return;
  }
  console.log(`bundled backend: ${bundled.backendUrl}`);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    enableExtensions: true,
    args: [
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${PROFILE}`,
    ],
  });

  try {
    const extId = await browser.installExtension(EXT);
    const popupUrl = `chrome-extension://${extId}/popup/popup.html`;
    await sleep(2500);

    /* ---- 1. a fresh install picks up the bundled backend ---- */
    console.log("");
    console.log("=== fresh install ===");
    let popup = await browser.newPage();
    popup.on("pageerror", (e) => console.log("  [popup error]", e.message));
    await popup.goto(popupUrl, { waitUntil: "domcontentloaded" });
    await sleep(4000);

    const fresh = await popup.evaluate(async () => {
      const s = await chrome.storage.local.get(["backendUrl", "apiKey"]);
      return {
        url: s.backendUrl,
        hasKey: Boolean(s.apiKey),
        health: document.getElementById("health").textContent.trim(),
        cls: document.getElementById("health").className,
      };
    });
    console.log(`  backend: ${fresh.url}`);
    console.log(`  health : "${fresh.health}"`);
    check("does not default to localhost", !/localhost/.test(fresh.url || ""));
    check("connects with no setup", fresh.cls.includes("ok"), fresh.health);

    /* ---- 2. a stale localhost URL repairs itself ---- */
    console.log("");
    console.log("=== stale localhost repair ===");
    await popup.evaluate(() =>
      chrome.storage.local.set({ backendUrl: "http://localhost:3000" }),
    );
    const before = await popup.evaluate(
      async () => (await chrome.storage.local.get("backendUrl")).backendUrl,
    );
    console.log(`  forced to: ${before}`);

    // Reopening the popup is what a person actually does, and it is enough:
    // the popup asks the worker to re-apply config before rendering.
    await popup.close();
    popup = await browser.newPage();
    await popup.goto(popupUrl, { waitUntil: "domcontentloaded" });
    await sleep(4500);

    const repaired = await popup.evaluate(async () => {
      const s = await chrome.storage.local.get("backendUrl");
      return {
        url: s.backendUrl,
        health: document.getElementById("health").textContent.trim(),
        cls: document.getElementById("health").className,
      };
    });
    console.log(`  now      : ${repaired.url}`);
    console.log(`  health   : "${repaired.health}"`);
    check(
      "a dead localhost is replaced by the bundled backend",
      !/localhost/.test(repaired.url || ""),
      repaired.url,
    );
    check("and it connects again", repaired.cls.includes("ok"), repaired.health);

    /* ---- 3. a CV import survives without a second click ---- */
    console.log("");
    console.log("=== CV import persists ===");
    await popup.evaluate(() => {
      [
        "name",
        "email",
        "location",
        "university",
        "degree",
        "minor",
        "graduationDate",
        "portfolio",
        "linkedin",
      ].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = "";
      });
      document.getElementById("skills").value = "";
      document.getElementById("save").click();
    });
    await sleep(900);

    await (await popup.$("#cvFile")).uploadFile(CV);
    await popup.click("#cvGo");

    let status = "";
    for (let i = 0; i < 60; i++) {
      await sleep(1000);
      status = await popup.evaluate(() =>
        document.getElementById("cvStatus").textContent.trim(),
      );
      if (!/^Reading/.test(status)) break;
    }
    console.log(`  parsed: "${status}"`);

    // Apply, and then do NOT press Save — that is the whole point.
    await popup.evaluate(() => document.getElementById("cvApply")?.click());
    await sleep(1800);
    const applyStatus = await popup.evaluate(() =>
      document.getElementById("cvStatus").textContent.trim(),
    );
    console.log(`  applied: "${applyStatus}"`);
    check("Apply says it saved", /saved/i.test(applyStatus), applyStatus);

    await popup.close();
    popup = await browser.newPage();
    await popup.goto(popupUrl, {
      waitUntil: "domcontentloaded",
    });
    await sleep(2000);

    const after = await popup.evaluate(async () => {
      const s = await chrome.storage.local.get(["profile", "cvImport"]);
      return {
        name: document.getElementById("name").value,
        skills: document.getElementById("skills").value,
        note: document.getElementById("cvImported").textContent.trim(),
        stored: s.profile?.name,
        cvImport: s.cvImport?.name,
      };
    });
    console.log(`  reopened: ${after.name} | ${after.skills.slice(0, 40)}`);
    console.log(`  note    : "${after.note}"`);
    check(
      "profile survived without pressing Save",
      after.name === "Priya Raman" && after.stored === "Priya Raman",
    );
    check("skills survived", after.skills.includes("Go"));
    check("it remembers which CV it came from", /sample-cv\.pdf/.test(after.cvImport || ""));
    check(
      "and says so, so you do not re-upload",
      /do not need to upload it again/i.test(after.note),
      after.note,
    );
  } catch (e) {
    console.log("ERROR:", e.message);
    failures++;
  } finally {
    await browser.close();
    try {
      fs.rmSync(PROFILE, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
    console.log("");
    console.log(`RESULT: ${failures ? `FAIL (${failures})` : "PASS"}`);
    process.exitCode = failures ? 1 : 0;
  }
})();
