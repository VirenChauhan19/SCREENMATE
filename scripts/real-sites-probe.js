/**
 * Read-only probe against LIVE employer application pages.
 *
 * It scans and classifies only. It never writes to a field, never clicks a
 * navigation control, and never submits — nothing reaches the employer. The
 * point is to find where the scanner breaks on real markup, which no fixture
 * can tell us.
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
const PROFILE = path.join(os.tmpdir(), `screenmate-real-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SITES = process.argv[2]
  ? [["custom", process.argv[2]]]
  : [
      [
        "Greenhouse / Cloudflare",
        "https://job-boards.greenhouse.io/cloudflare/jobs/8052785",
      ],
      [
        "Greenhouse / Point72",
        "https://job-boards.greenhouse.io/point72/jobs/8202068002",
      ],
      [
        "Greenhouse / Glean",
        "https://job-boards.greenhouse.io/gleanwork/jobs/4592324005",
      ],
      [
        "Lever / Metabase",
        "https://jobs.lever.co/metabase/85f454d8-e795-4978-8a2b-4b8bfa7d7c37/apply",
      ],
      [
        "Lever / Instrumentl",
        "https://jobs.lever.co/Instrumentl/85b9edb5-b23d-4a44-8d0a-3f861130b397/apply",
      ],
      [
        "Lever / Supermove",
        "https://jobs.lever.co/supermove/176fe130-a2cc-40da-b978-8c693fefc510/apply",
      ],
    ];

const BACKEND = (() => {
  const f = path.join(EXT, "config.json");
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {};
})();

async function classify(fields) {
  if (!BACKEND.backendUrl) return null;
  const r = await fetch(`${BACKEND.backendUrl}/api/classify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-screenmate-key": BACKEND.apiKey || "",
    },
    body: JSON.stringify({ fields }),
  });
  return r.ok ? await r.json() : { error: r.status };
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: [
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${PROFILE}`,
    ],
  });

  const summary = [];

  try {
    for (const [name, url] of SITES) {
      console.log("");
      console.log(`=== ${name} ===`);
      const page = await browser.newPage();
      await page.setViewport({ width: 1400, height: 1000 });
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
      );

      try {
        await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });
      } catch (e) {
        console.log(`  page did not load: ${e.message.slice(0, 60)}`);
        summary.push({ name, status: "page did not load" });
        await page.close();
        continue;
      }
      await sleep(3500);

      for (const file of ["scan.js", "act.js", "nav.js"]) {
        await page.evaluate(
          (src) => {
            const s = document.createElement("script");
            s.textContent = src;
            document.documentElement.append(s);
          },
          fs.readFileSync(path.join(EXT, "content", file), "utf8"),
        );
      }

      const seen = await page.evaluate(() => {
        const fields = window.__screenmateScan.scanFields();
        const next = window.__screenmateNav.findAdvanceControl();
        const submit = window.__screenmateNav.findSubmitControl();
        const ctx = window.__screenmateScan.pageContext();
        return {
          count: fields.length,
          display: fields.map((f) => ({
            label: f.label.slice(0, 56),
            type: f.type,
            required: f.required,
            opts: f.options?.length || 0,
          })),
          raw: fields.map((f) => ({
            id: f.id,
            label: f.label,
            type: f.type,
            required: f.required,
            options: f.options,
          })),
          advance: next?.text || null,
          submit: submit?.text || null,
          title: ctx.jobTitle,
          descLen: ctx.jobDescription.length,
        };
      });

      console.log(`  title   : ${seen.title.slice(0, 60)}`);
      console.log(`  fields  : ${seen.count}  (desc ${seen.descLen} chars)`);
      seen.display
        .slice(0, 16)
        .forEach((f) =>
          console.log(
            `     ${f.type.padEnd(9)}${f.required ? "* " : "  "}${f.label}${f.opts ? ` [${f.opts}]` : ""}`,
          ),
        );
      if (seen.count > 16) console.log(`     … ${seen.count - 16} more`);
      console.log(`  advance : ${seen.advance || "(none)"}`);
      console.log(`  submit  : ${seen.submit || "(none)"}`);

      // Classified from Node, not the page: a page-world fetch hits the site's
      // connect-src CSP, which Greenhouse sets. The real extension calls the
      // backend from its service worker and is not affected.
      let policy = null;
      let junk = 0;
      if (seen.count) {
        try {
          const data = await classify(seen.raw);
          if (data?.counts) {
            policy = data.counts;
            console.log(
              `  policy  : ${data.counts.safe} safe / ${data.counts.review} review / ${data.counts.sensitive} sensitive`,
            );
            data.fields
              .filter((f) => f.level === "sensitive")
              .slice(0, 8)
              .forEach((f) =>
                console.log(
                  `     LOCKED  ${f.label.slice(0, 52)}${f.topic ? `  [${f.topic}]` : ""}`,
                ),
              );
          } else {
            console.log(`  policy  : failed ${JSON.stringify(data).slice(0, 50)}`);
          }
        } catch (e) {
          console.log(`  policy  : error ${e.message.slice(0, 46)}`);
        }

        // A label that is still a raw field name means extraction failed.
        junk = seen.raw.filter(
          (f) =>
            /^(cards\[|question_|job_application|input_|[a-f0-9-]{16,})/i.test(
              f.label,
            ) || f.label === "Untitled field",
        ).length;
        if (junk) console.log(`  WARN    : ${junk} label(s) fell back to a raw name`);
      }

      summary.push({
        name,
        fields: seen.count,
        submit: seen.submit,
        sensitive: policy?.sensitive ?? null,
        junk,
      });
      await page.close();
    }
  } catch (e) {
    console.log("ERROR:", e.message);
  } finally {
    await browser.close();
    try {
      fs.rmSync(PROFILE, { recursive: true, force: true });
    } catch {
      /* best effort */
    }

    console.log("");
    console.log("=== SUMMARY ===");
    for (const s of summary) {
      if (s.status) {
        console.log(`  ${s.name.padEnd(26)} ${s.status}`);
        continue;
      }
      const verdict =
        s.fields < 4
          ? "not an application form"
          : s.junk
            ? `USABLE, ${s.junk} bad label(s)`
            : "clean";
      console.log(
        `  ${s.name.padEnd(26)} ${String(s.fields).padStart(3)} fields  ` +
          `${String(s.sensitive ?? "-").padStart(2)} locked  ` +
          `submit=${s.submit ? "found" : "none"}  ${verdict}`,
      );
    }
  }
})();
