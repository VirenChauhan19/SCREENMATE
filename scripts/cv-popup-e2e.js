/**
 * Drives CV import through the real popup UI with a real file.
 *
 * The API was tested with curl and passed; the popup path was broken the whole
 * time. This exercises what a person actually clicks.
 */
const puppeteer = require("puppeteer-core");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { configureExtension } = require("./ext-helpers");

const CHROME = path.join(
  "C:", "Program Files", "Google", "Chrome", "Application", "chrome.exe",
);
const EXT = path.resolve(__dirname, "..", "extension");
const CV_DIR = path.resolve(__dirname, "..", "fixtures", "cv");
const PROFILE = path.join(os.tmpdir(), `screenmate-cv-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BACKEND = process.argv[2] || "http://localhost:3000";

(async () => {
  let failures = 0;
  const check = (n, ok, d = "") => {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? ` - ${d}` : ""}`);
    if (!ok) failures++;
  };

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    enableExtensions: true,
    args: ["--no-first-run", "--no-default-browser-check", `--user-data-dir=${PROFILE}`],
  });

  try {
    const extId = await browser.installExtension(EXT);
    await configureExtension(browser, extId, { backendUrl: BACKEND });
    console.log(`backend: ${BACKEND}`);

    for (const name of ["sample-cv.pdf", "sample-cv.docx"]) {
      console.log(`\n=== ${name} through the popup ===`);
      const popup = await browser.newPage();
      popup.on("pageerror", (e) => console.log("  [popup error]", e.message));
      await popup.goto(`chrome-extension://${extId}/popup/popup.html`, {
        waitUntil: "domcontentloaded",
      });
      await sleep(1200);

      // Wipe the profile fields so the diff has something to show.
      await popup.evaluate(() => {
        ["name", "email", "location", "university", "degree", "minor",
         "graduationDate", "portfolio", "linkedin"].forEach((id) => {
          const el = document.getElementById(id);
          if (el) el.value = "";
        });
        document.getElementById("skills").value = "";
      });

      const input = await popup.$("#cvFile");
      await input.uploadFile(path.join(CV_DIR, name));
      await popup.click("#cvGo");

      // Wait for the status line to settle.
      let status = "";
      for (let i = 0; i < 60; i++) {
        await sleep(1000);
        status = await popup.evaluate(
          () => document.getElementById("cvStatus").textContent.trim(),
        );
        if (!/^Reading/.test(status)) break;
      }
      const cls = await popup.evaluate(
        () => document.getElementById("cvStatus").className,
      );
      console.log(`  status: "${status}"`);
      check(`${name}: popup reports success`, cls.includes("ok"), status);

      const rows = await popup.evaluate(() =>
        [...document.querySelectorAll(".drow")].map((r) => ({
          k: r.querySelector(".dk")?.textContent,
          v: r.querySelector(".dnew")?.textContent,
        })),
      );
      console.log(`  diff rows: ${rows.length}`);
      rows.slice(0, 4).forEach((r) => console.log(`    ${r.k}: ${r.v}`));
      check(`${name}: shows a diff to review`, rows.length >= 5, `${rows.length} rows`);
      check(
        `${name}: extracted the right name`,
        rows.some((r) => /Priya Raman/.test(r.v || "")),
      );

      // Apply, then confirm the fields really changed.
      const applied = await popup.evaluate(async () => {
        document.getElementById("cvApply")?.click();
        await new Promise((r) => setTimeout(r, 300));
        return {
          name: document.getElementById("name").value,
          university: document.getElementById("university").value,
          skills: document.getElementById("skills").value,
        };
      });
      console.log(`  applied -> ${applied.name} | ${applied.university}`);
      check(`${name}: Apply fills the form`, applied.name === "Priya Raman");
      check(`${name}: skills applied`, (applied.skills || "").includes("Go"));

      await popup.close();
    }

    // A file type we do not support must fail clearly, not generically.
    console.log(`\n=== unsupported file ===`);
    const bad = path.join(os.tmpdir(), `not-a-cv-${process.pid}.png`);
    fs.writeFileSync(bad, Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]));
    const popup = await browser.newPage();
    await popup.goto(`chrome-extension://${extId}/popup/popup.html`, {
      waitUntil: "domcontentloaded",
    });
    await sleep(1000);
    await (await popup.$("#cvFile")).uploadFile(bad);
    await popup.click("#cvGo");
    await sleep(6000);
    const badStatus = await popup.evaluate(
      () => document.getElementById("cvStatus").textContent.trim(),
    );
    console.log(`  status: "${badStatus}"`);
    check(
      "unsupported file gets a specific message",
      /unsupported|pdf|docx/i.test(badStatus) && !/could not reach/i.test(badStatus),
      badStatus,
    );
    fs.rmSync(bad, { force: true });
    await popup.close();
  } catch (e) {
    console.log("ERROR:", e.message);
    failures++;
  } finally {
    await browser.close();
    try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {}
    console.log(`\nRESULT: ${failures ? `FAIL (${failures})` : "PASS"}`);
    process.exitCode = failures ? 1 : 0;
  }
})();
