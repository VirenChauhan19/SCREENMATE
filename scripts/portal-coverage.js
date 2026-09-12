/**
 * Scanner/nav coverage across the major ATS shapes.
 *
 * Deliberately cheap: it injects scan/act/nav into each page and checks what the
 * extension can SEE and OPERATE, with no model calls. That makes it fast enough
 * to run on every change, and it is where portal-specific breakage shows up.
 */
const puppeteer = require("puppeteer-core");
const path = require("path");
const os = require("os");
const fs = require("fs");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EXT = path.resolve(__dirname, "..", "extension");
const BASE = "http://localhost:8099/portals";
const PROFILE = path.join(os.tmpdir(), `screenmate-cov-${Date.now()}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** What each fixture must expose for the agent to be able to work on it. */
const CASES = [
  {
    name: "Greenhouse-style (react-select, file upload, consent)",
    url: `${BASE}/greenhouse.html`,
    expect: {
      minFields: 8,
      mustFind: ["Full name", "Email", "Highest degree", "Why are you interested"],
      selects: ["Highest degree attained", "Are you authorized to work in the US?"],
      fileField: true,
      advance: null,
      sensitiveLabels: ["Are you authorized to work in the US?"],
    },
  },
  {
    name: "Lever-style (plain HTML, radio group)",
    url: `${BASE}/lever.html`,
    expect: {
      minFields: 6,
      mustFind: ["Full name", "Email", "What interests you"],
      selects: ["Will you require visa sponsorship?"],
      advance: null,
      sensitiveLabels: ["Will you require visa sponsorship?"],
    },
  },
  {
    name: "Ashby-style (typeahead combobox, ARIA radiogroup)",
    url: `${BASE}/ashby.html`,
    expect: {
      minFields: 6,
      mustFind: ["Name", "Email", "School", "Why Meridian?"],
      selects: ["Are you willing to relocate?"],
      typeahead: "School",
      advance: null,
      sensitiveLabels: ["Are you willing to relocate?"],
    },
  },
  {
    name: "Taleo-style (form inside an IFRAME, table layout)",
    url: `${BASE}/taleo-host.html`,
    inFrame: true,
    expect: {
      minFields: 6,
      mustFind: ["Full Name", "E-mail Address", "Education Level"],
      selects: ["Education Level"],
      advance: "Next",
      sensitiveLabels: ["Are you legally eligible to work in the country of employment?"],
    },
  },
];

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-first-run", "--no-default-browser-check", `--user-data-dir=${PROFILE}`],
  });

  let failures = 0;
  const check = (name, cond, detail = "") => {
    console.log(`    ${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
    if (!cond) failures++;
  };

  try {
    for (const c of CASES) {
      console.log(`\n=== ${c.name} ===`);
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900 });
      await page.goto(c.url, { waitUntil: "networkidle2" });
      await sleep(700);

      // Target the frame the form actually lives in.
      const frames = page.frames();
      const target = c.inFrame
        ? frames.find((f) => f !== page.mainFrame()) || page.mainFrame()
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

      const got = await target.evaluate(() => {
        const fields = window.__screenmateScan.scanFields();
        const next = window.__screenmateNav.findAdvanceControl();
        return {
          count: fields.length,
          list: fields.map((f) => ({
            label: f.label,
            type: f.type,
            id: f.id,
            opts: f.options?.length || 0,
          })),
          advance: next?.text || null,
          submit: window.__screenmateNav.findSubmitControl()?.text || null,
          ctx: window.__screenmateScan.pageContext(),
        };
      });

      console.log(`  fields: ${got.count}`);
      got.list.forEach((f) =>
        console.log(`    ${f.type.padEnd(9)} ${f.label.slice(0, 48)}`),
      );
      console.log(`  advance: ${got.advance} | submit: ${got.submit}`);
      console.log(`  company: ${got.ctx.company} | title: ${got.ctx.jobTitle}`);

      check(
        `finds >= ${c.expect.minFields} fields`,
        got.count >= c.expect.minFields,
        `got ${got.count}`,
      );

      for (const want of c.expect.mustFind) {
        check(
          `sees "${want}"`,
          got.list.some((f) => f.label.toLowerCase().includes(want.toLowerCase())),
        );
      }

      for (const want of c.expect.selects) {
        const f = got.list.find((x) =>
          x.label.toLowerCase().includes(want.toLowerCase().slice(0, 18)),
        );
        check(`"${want.slice(0, 30)}" typed as a choice field`, f?.type === "select");
      }

      if (c.expect.fileField) {
        check(
          "resume/file input surfaced as a user task",
          got.list.some((f) => f.type === "file"),
        );
      }

      if (c.expect.advance) {
        check(
          `advance control = "${c.expect.advance}"`,
          got.advance === c.expect.advance,
          `got ${got.advance}`,
        );
      }

      // Options must be readable, since guessing them is how wrong answers happen.
      for (const want of c.expect.selects) {
        const field = await target.evaluate(async (lbl) => {
          const f = window.__screenmateScan
            .scanFields()
            .find((x) => x.label.toLowerCase().includes(lbl.toLowerCase().slice(0, 18)));
          if (!f) return null;
          const opts = await window.__screenmateAct.readOptions(f);
          return { label: f.label, opts };
        }, want);
        check(
          `can read options for "${want.slice(0, 28)}"`,
          Boolean(field && field.opts.length >= 2),
          field ? `${field.opts.length} options: ${field.opts.slice(0, 3).join(", ")}` : "field missing",
        );
      }

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
