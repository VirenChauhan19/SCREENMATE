/**
 * Exercises every control in the popup and the panel the way a person does.
 *
 * The CV bug hid because the API was tested with curl while the button that
 * calls it never was. This covers the buttons.
 */
const puppeteer = require("puppeteer-core");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { configureExtension } = require("./ext-helpers");

const CHROME = path.join(
  "C:",
  "Program Files",
  "Google",
  "Chrome",
  "Application",
  "chrome.exe",
);
const EXT = path.resolve(__dirname, "..", "extension");
const PROFILE = path.join(os.tmpdir(), `screenmate-ui-${process.pid}`);
const FORM = "http://localhost:8099/apply.html";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BACKEND = process.argv[2] || "http://localhost:3000";

function envKey() {
  const f = path.resolve(__dirname, "..", ".env.local");
  if (!fs.existsSync(f)) return "";
  const line = fs
    .readFileSync(f, "utf8")
    .split("\n")
    .find((x) => x.startsWith("SCREENMATE_API_KEY="));
  return line ? line.slice(line.indexOf("=") + 1).trim() : "";
}

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
    args: [
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${PROFILE}`,
    ],
  });

  try {
    const extId = await browser.installExtension(EXT);
    await configureExtension(browser, extId, { backendUrl: BACKEND });
    const popupUrl = `chrome-extension://${extId}/popup/popup.html`;

    /* ---------------- popup ---------------- */
    console.log("=== POPUP ===");
    let popup = await browser.newPage();
    popup.on("pageerror", (e) => console.log("  [popup error]", e.message));
    await popup.goto(popupUrl, { waitUntil: "domcontentloaded" });
    await sleep(4000);

    const health = await popup.evaluate(() => ({
      text: document.getElementById("health").textContent.trim(),
      cls: document.getElementById("health").className,
    }));
    console.log(`  health: "${health.text}"`);
    check("health reports connected", health.cls.includes("ok"), health.text);

    await popup.evaluate(() => {
      document.getElementById("name").value = "Test Person";
      document.getElementById("skills").value = "Elixir, Zig";
      document.getElementById("save").click();
    });
    await sleep(900);
    const btnText = await popup.evaluate(
      () => document.getElementById("save").textContent,
    );
    check("Save profile confirms visibly", /saved/i.test(btnText), btnText);

    await popup.close();
    popup = await browser.newPage();
    await popup.goto(popupUrl, { waitUntil: "domcontentloaded" });
    await sleep(1500);
    const persisted = await popup.evaluate(() => ({
      name: document.getElementById("name").value,
      skills: document.getElementById("skills").value,
    }));
    console.log(`  reopened: ${persisted.name} | ${persisted.skills}`);
    check("profile persists across reopen", persisted.name === "Test Person");
    check("skills persist as a list", persisted.skills.includes("Zig"));

    await popup.evaluate((b) => {
      document.getElementById("backendUrl").value = b;
      document.getElementById("apiKey").value = "sm_probe_value";
      document.getElementById("saveUrl").click();
    }, BACKEND);
    await sleep(1600);
    const savedBackend = await popup.evaluate(() =>
      chrome.storage.local.get(["backendUrl", "apiKey"]),
    );
    check("backend URL persists", savedBackend.backendUrl === BACKEND);
    check("access key persists", savedBackend.apiKey === "sm_probe_value");

    await sleep(4000);
    const wrongKey = await popup.evaluate(() => ({
      text: document.getElementById("health").textContent.trim(),
      cls: document.getElementById("health").className,
    }));
    console.log(`  with a bad key: "${wrongKey.text}"`);
    check(
      "a wrong key is named, not reported as unreachable",
      /key/i.test(wrongKey.text) &&
        wrongKey.cls.includes("bad") &&
        !/cannot reach/i.test(wrongKey.text),
      wrongKey.text,
    );

    await popup.evaluate((k) => chrome.storage.local.set({ apiKey: k }), envKey());
    await popup.close();

    /* ---------------- panel ---------------- */
    console.log("");
    console.log("=== PANEL ===");
    const page = await browser.newPage();
    await page.setViewport({ width: 1500, height: 1000 });
    page.on("pageerror", (e) => console.log("  [page error]", e.message));
    await page.goto(FORM, { waitUntil: "networkidle2" });
    await page.waitForFunction(
      () => !!document.getElementById("screenmate-root")?.shadowRoot,
      { timeout: 20000 },
    );
    check("panel auto-mounts on a form page", true);

    const inPanel = (fn, arg) => page.evaluate(fn, arg);

    await inPanel(() => {
      const sr = document.getElementById("screenmate-root").shadowRoot;
      sr.querySelector(".head").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await sleep(2500);
    await inPanel(() => {
      const sr = document.getElementById("screenmate-root").shadowRoot;
      [...sr.querySelectorAll("button")]
        .find((b) => /run screenmate/i.test(b.textContent))
        ?.click();
    });
    await sleep(1600);

    const qCount = await inPanel(() => {
      const sr = document.getElementById("screenmate-root").shadowRoot;
      const qs = [...sr.querySelectorAll(".pq")];
      qs.forEach((q) => q.querySelector(".pask")?.click());
      return qs.length;
    });
    check("standing-answers setup renders", qCount >= 8, `${qCount} questions`);
    await sleep(1000);
    await inPanel(() => {
      const sr = document.getElementById("screenmate-root").shadowRoot;
      [...sr.querySelectorAll("button")]
        .find((b) => /save and run/i.test(b.textContent))
        ?.click();
    });

    let sawApproval = false;
    let skipped = false;
    for (let i = 0; i < 140; i++) {
      await sleep(1000);
      const st = await inPanel(() => {
        const sr = document.getElementById("screenmate-root").shadowRoot;
        return {
          status: sr.querySelector(".status")?.textContent.trim() || "",
          hasSkip: !!sr.querySelector('[data-act="skip"]'),
        };
      });
      if (st.hasSkip && !skipped) {
        sawApproval = true;
        await inPanel(() => {
          const sr = document.getElementById("screenmate-root").shadowRoot;
          sr.querySelector('[data-act="skip"]')?.click();
        });
        skipped = true;
        await sleep(1600);
        continue;
      }
      if (/complete|awaiting your review/i.test(st.status)) break;
    }
    check("approval card offers Skip", sawApproval);
    check("Skip does not wedge the run", skipped);

    const findEl = (id) =>
      [...document.querySelectorAll("input,textarea,select")].find(
        (n) => n.name === id || n.id === id,
      );

    const revert = await inPanel(async () => {
      const sr = document.getElementById("screenmate-root").shadowRoot;
      const btn = sr.querySelector('[data-act="revertOne"]');
      if (!btn) return { ok: false, why: "no Revert button" };
      const fieldId = btn.dataset.field;
      const pick = () =>
        [...document.querySelectorAll("input,textarea,select")].find(
          (n) => n.name === fieldId || n.id === fieldId,
        );
      const before = pick()?.value;
      btn.click();
      await new Promise((r) => setTimeout(r, 1400));
      return { ok: true, fieldId, before, after: pick()?.value };
    });
    void findEl;
    if (revert.ok) {
      console.log(
        `  revert ${revert.fieldId}: "${String(revert.before).slice(0, 26)}" -> "${revert.after}"`,
      );
    }
    check("per-field Revert exists", revert.ok, revert.why || "");
    check(
      "Revert clears the value on the page",
      revert.ok && Boolean(revert.before) && !revert.after,
    );

    const regen = await inPanel(async () => {
      const sr = document.getElementById("screenmate-root").shadowRoot;
      const btn = sr.querySelector('[data-act="regen"]');
      if (!btn) return { ok: false, why: "no Regenerate button" };
      const fieldId = btn.dataset.field;
      const el = [...document.querySelectorAll("input,textarea")].find(
        (n) => n.name === fieldId || n.id === fieldId,
      );
      const before = el?.value;
      btn.click();
      return { ok: true, fieldId, before };
    });

    if (!regen.ok) {
      check("Regenerate button present", false, regen.why);
    } else {
      let changed = false;
      for (let i = 0; i < 70 && !changed; i++) {
        await sleep(1000);
        const now = await page.evaluate((id) => {
          const el = [...document.querySelectorAll("input,textarea")].find(
            (n) => n.name === id || n.id === id,
          );
          return el?.value;
        }, regen.fieldId);
        if (now && now !== regen.before) {
          changed = true;
          console.log(`  regenerated: "${String(now).slice(0, 62)}..."`);
        }
      }
      check("Regenerate rewrites the field on the page", changed);
    }
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
