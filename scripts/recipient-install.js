/**
 * Simulates a stranger receiving the zip: unpack to a clean directory, install
 * into a fresh Chrome profile, touch no settings, and confirm it reaches the
 * hosted backend on its own.
 */
const puppeteer = require("puppeteer-core");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { unzipSync } = require("fflate");

const CHROME = path.join(
  "C:", "Program Files", "Google", "Chrome", "Application", "chrome.exe",
);
const ZIP = path.resolve(__dirname, "..", "dist", "screenmate-1.0.0.zip");
const STAGE = path.join(os.tmpdir(), `screenmate-recipient-${process.pid}`);
const PROFILE = path.join(os.tmpdir(), `screenmate-recipient-profile-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let failures = 0;
  const check = (n, ok, d = "") => {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`);
    if (!ok) failures++;
  };

  // Unpack the zip exactly as a recipient would.
  fs.rmSync(STAGE, { recursive: true, force: true });
  const files = unzipSync(new Uint8Array(fs.readFileSync(ZIP)));
  for (const [name, bytes] of Object.entries(files)) {
    const out = path.join(STAGE, name);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(bytes));
  }
  console.log(`unpacked ${Object.keys(files).length} files to a clean directory`);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    enableExtensions: true,
    args: ["--no-first-run", "--no-default-browser-check", `--user-data-dir=${PROFILE}`],
  });

  try {
    const extId = await browser.installExtension(STAGE);
    console.log(`installed: ${extId}`);
    await sleep(2500);

    // Open the popup and read what it reports, touching nothing.
    const popup = await browser.newPage();
    await popup.goto(`chrome-extension://${extId}/popup/popup.html`, {
      waitUntil: "domcontentloaded",
    });
    await sleep(4000);

    const state = await popup.evaluate(async () => {
      const s = await chrome.storage.local.get(["backendUrl", "apiKey", "profile"]);
      return {
        backendUrl: s.backendUrl,
        hasKey: Boolean(s.apiKey),
        hasProfile: Boolean(s.profile),
        health: document.getElementById("health")?.textContent || "",
        healthClass: document.getElementById("health")?.className || "",
      };
    });

    console.log(`backend seeded : ${state.backendUrl}`);
    console.log(`key seeded     : ${state.hasKey}`);
    console.log(`popup says     : "${state.health.trim()}"`);

    check("backend URL seeded from the zip", /vercel\.app/.test(state.backendUrl || ""));
    check("access key seeded from the zip", state.hasKey);
    check("default profile present", state.hasProfile);
    check(
      "popup reports a working connection",
      /connected/i.test(state.health) && state.healthClass.includes("ok"),
      state.health.trim(),
    );

    // And prove it can actually call the hosted API from this clean install.
    const live = await popup.evaluate(
      () =>
        new Promise((r) =>
          chrome.runtime.sendMessage(
            {
              type: "screenmate:api",
              route: "classify",
              body: {
                fields: [
                  {
                    id: "q1",
                    label: "Will you require visa sponsorship?",
                    type: "select",
                    required: true,
                  },
                ],
              },
            },
            r,
          ),
        ),
    );
    check(
      "a real API call succeeds with zero setup",
      live?.ok && live.data?.fields?.[0]?.level === "sensitive",
      live?.ok ? `classified ${live.data.fields[0].level}` : `${live?.error} ${live?.reason || ""}`,
    );
  } catch (e) {
    console.log("ERROR:", e.message);
    failures++;
  } finally {
    await browser.close();
    for (const d of [STAGE, PROFILE]) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
    }
    console.log(`
RESULT: ${failures ? `FAIL (${failures})` : "PASS"}`);
    process.exitCode = failures ? 1 : 0;
  }
})();
