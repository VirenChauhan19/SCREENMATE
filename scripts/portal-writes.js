/**
 * Proves writes actually land on each portal shape.
 *
 * Coverage tells us what the extension can SEE; this tells us what it can
 * CHANGE. Every assertion reads the page's own state back, not our return value.
 */
const puppeteer = require("puppeteer-core");
const path = require("path");
const os = require("os");
const fs = require("fs");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EXT = path.resolve(__dirname, "..", "extension");
const BASE = "http://localhost:8099/portals";
const PROFILE = path.join(os.tmpdir(), `screenmate-pw-${Date.now()}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CASES = [
  {
    name: "Greenhouse-style — react-select control + file handoff",
    url: `${BASE}/greenhouse.html`,
    writes: [
      ["Full name", "Viren Chauhan"],
      ["Highest degree attained", "BFA Game Design"],
      ["Are you authorized to work in the US?", "Yes"],
    ],
    verify: (v) => ({
      "name landed": v.fn === "Viren Chauhan",
      "react-select degree set": v.edu === "BFA Game Design",
      "react-select auth set": v.auth === "Yes",
      "consent checkbox untouched": v.consent === false,
    }),
  },
  {
    name: "Lever-style — radio group by question label",
    url: `${BASE}/lever.html`,
    writes: [
      ["Full name", "Viren Chauhan"],
      ["Will you require visa sponsorship?", "No"],
    ],
    verify: (v) => ({
      "name landed": v.name === "Viren Chauhan",
      "radio group set from question label": v.spon === "No",
    }),
  },
  {
    name: "Ashby-style — typeahead that opens on input",
    url: `${BASE}/ashby.html`,
    writes: [
      ["Name", "Viren Chauhan"],
      ["School", "SCAD"],
      ["Are you willing to relocate?", "Yes"],
    ],
    verify: (v) => ({
      "name landed": v.name === "Viren Chauhan",
      "typeahead text set": v.school === "SCAD",
      "typeahead suggestion actually clicked": v.schoolConfirmed === true,
      "aria radiogroup set": v.relocate === "Yes",
    }),
  },
  {
    name: "Taleo-style — form inside an iframe",
    url: `${BASE}/taleo-host.html`,
    inFrame: true,
    writes: [
      ["Full Name", "Viren Chauhan"],
      ["Education Level", "BFA Game Design"],
      ["Are you legally eligible to work in the country of employment?", "Yes"],
    ],
    verify: (v) => ({
      "name landed inside iframe": v.name === "Viren Chauhan",
      "native select set": v.edu === "BFA Game Design",
      "eligibility select set": v.auth === "Yes",
    }),
  },
];

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-first-run", "--no-default-browser-check", `--user-data-dir=${PROFILE}`],
  });

  let failures = 0;
  const check = (n, ok, d = "") => {
    console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`);
    if (!ok) failures++;
  };

  try {
    for (const c of CASES) {
      console.log(`\n=== ${c.name} ===`);
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900 });
      await page.goto(c.url, { waitUntil: "networkidle2" });
      await sleep(600);

      const target = c.inFrame
        ? page.frames().find((f) => f !== page.mainFrame())
        : page.mainFrame();

      for (const file of ["scan.js", "act.js", "nav.js"]) {
        await target.evaluate(
          (src) => {
            const s = document.createElement("script");
            s.textContent = src;
            document.documentElement.append(s);
          },
          fs.readFileSync(path.join(EXT, "content", file), "utf8"),
        );
      }

      for (const [label, value] of c.writes) {
        const res = await target.evaluate(
          async ([lbl, val]) => {
            const f = window.__screenmateScan
              .scanFields()
              .find((x) => x.label.toLowerCase().includes(lbl.toLowerCase().slice(0, 20)));
            if (!f) return { found: false };
            const w = await window.__screenmateAct.applyWrite(f, val);
            await new Promise((r) => setTimeout(r, 250));
            const v = window.__screenmateAct.verifyWrite(f, val);
            return { found: true, ok: w.ok, reason: w.reason, verified: v.ok, actual: v.actual };
          },
          [label, value],
        );
        console.log(
          `  write "${label.slice(0, 34)}" = "${value}" -> ` +
            `${res.found ? (res.ok ? "ok" : `refused: ${res.reason}`) : "FIELD NOT FOUND"}` +
            `${res.found ? ` | verified=${res.verified} actual=${JSON.stringify(String(res.actual).slice(0, 30))}` : ""}`,
        );
        check(`write reached the page: ${label.slice(0, 32)}`, res.found && res.verified);
      }

      const vals = await target.evaluate(() => window.__vals());
      for (const [name, ok] of Object.entries(c.verify(vals))) check(name, ok);

      await page.close();
    }
  } catch (err) {
    console.log("ERROR:", err.message);
    failures++;
  } finally {
    await browser.close();
    try {
      fs.rmSync(PROFILE, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
    console.log(`\nRESULT: ${failures ? `FAIL (${failures})` : "PASS"}`);
    process.exitCode = failures ? 1 : 0;
  }
})();
