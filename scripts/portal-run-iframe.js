/**
 * Full agent run on an iframe-embedded portal, through the real extension.
 * This is the architectural test: the panel must be elected into the frame that
 * actually holds the form, while the job context comes from the parent page.
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
const PAGE = "http://localhost:8099/portals/taleo-host.html";
const PROFILE = path.join(os.tmpdir(), `screenmate-if-${Date.now()}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    enableExtensions: true,
    args: ["--no-first-run", "--no-default-browser-check", "--window-size=1400,1000",
           `--user-data-dir=${PROFILE}`],
  });
  let failures = 0;
  const check = (n, ok, d = "") => {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`);
    if (!ok) failures++;
  };

  try {
    const extId = await browser.installExtension(EXT);
    await configureExtension(browser, extId);
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 1000 });
    page.on("dialog", async (d) => { console.log(`  [alert] ${d.message()}`); await d.dismiss(); });
    await page.goto(PAGE, { waitUntil: "networkidle2" });
    await sleep(4000);

    // Which frame won the election?
    const frames = page.frames();
    const owners = [];
    for (const f of frames) {
      const has = await f.evaluate(() => !!document.getElementById("screenmate-root")).catch(() => false);
      if (has) owners.push(f === page.mainFrame() ? "top" : "iframe");
    }
    console.log(`panel mounted in: ${owners.join(", ") || "nowhere"}`);
    check("exactly one frame owns the panel", owners.length === 1);
    check("the frame with the form won", owners[0] === "iframe");

    const formFrame = page.frames().find((f) => f !== page.mainFrame());
    const sr = async (fn, arg) => formFrame.evaluate(fn, arg);

    // Open the panel first; its own "Current context" section is the honest
    // read of what the agent thinks it is applying to.
    await sr(() => {
      const root = document.getElementById("screenmate-root").shadowRoot;
      root.querySelector(".head").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await sleep(2500);

    const ctx = await sr(() => {
      const root = document.getElementById("screenmate-root").shadowRoot;
      return {
        title: root.querySelector(".ttl")?.textContent.trim() || "",
        company: root.querySelector(".sub")?.textContent.trim() || "",
      };
    });
    console.log(`panel context: ${ctx.title} / ${ctx.company}`);
    check("company read from the parent page", /atlas/i.test(ctx.company));
    check("job title read from the parent page", /logistics/i.test(ctx.title));
    await sr(() => {
      const root = document.getElementById("screenmate-root").shadowRoot;
      [...root.querySelectorAll("button")].find((b) => /run screenmate/i.test(b.textContent))?.click();
    });
    await sleep(1500);
    await sr(() => {
      const root = document.getElementById("screenmate-root").shadowRoot;
      root.querySelectorAll(".pq").forEach((q) => {
        const f = q.querySelector('.pfree'); if (f) { f.value = "Negotiable"; return; }
        const yes = [...q.querySelectorAll(".popt")].find((o) => /^yes$/i.test(o.textContent.trim()));
        (yes || q.querySelector(".popt"))?.click();
      });
    });
    await sleep(900);
    await sr(() => {
      const root = document.getElementById("screenmate-root").shadowRoot;
      [...root.querySelectorAll("button")].find((b) => /save and run/i.test(b.textContent))?.click();
    });

    let status = "", answered = 0;
    for (let i = 0; i < 150; i++) {
      await sleep(1000);
      status = await sr(() => {
        const root = document.getElementById("screenmate-root").shadowRoot;
        return root.querySelector(".status")?.textContent.trim() || "";
      });
      if (/waiting for user/i.test(status)) {
        await sr(() => {
          const root = document.getElementById("screenmate-root").shadowRoot;
          const free = root.querySelector(".afree");
          if (free) { free.value = "Negotiable"; root.querySelector('[data-act="answerFree"]')?.click(); return; }
          root.querySelector(".opt")?.click();
        });
        if (++answered > 8) break;
        await sleep(1500);
        continue;
      }
      if (/complete|awaiting your review|unavailable/i.test(status)) break;
    }
    console.log(`final status: ${status} (asked ${answered})`);

    const vals = await sr(() => window.__vals());
    console.log("form values:");
    for (const [k, v] of Object.entries(vals)) {
      console.log(`   ${k.padEnd(6)} ${JSON.stringify(String(v).slice(0, 56))}`);
    }
    check("name filled inside the iframe", /Viren/i.test(vals.name));
    check("email filled", /@/.test(vals.mail));
    check("native select set", (vals.edu || "").length > 2);
    check("motivation written", (vals.why || "").length > 80);
    check(
      "motivation references the PARENT page's job",
      /atlas|freight|dispatch|logistic|cargo/i.test(vals.why || ""),
    );

    await page.screenshot({ path: "fixtures/iframe-run.png" });
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
