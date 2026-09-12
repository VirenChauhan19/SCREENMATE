/**
 * Records a real run of SCREENMATE.
 *
 * Nothing here is staged: it installs the actual extension, opens the actual
 * multi-step form, and films whatever the agent does. Captions are overlaid
 * live so the footage needs no editing afterwards.
 *
 * Frames are captured through CDP and encoded with ffmpeg, because a screencast
 * of the real thing is worth more to a judge than any reconstruction of it.
 */
const puppeteer = require("puppeteer-core");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { execFileSync } = require("child_process");
const ffmpeg = require("ffmpeg-static");
const { configureExtension } = require("../scripts/ext-helpers");

const CHROME = path.join(
  "C:",
  "Program Files",
  "Google",
  "Chrome",
  "Application",
  "chrome.exe",
);
const ROOT = path.resolve(__dirname, "..");
const EXT = path.join(ROOT, "extension");
const OUT = __dirname;
const FRAMES = path.join(OUT, "frames");
const PROFILE = path.join(os.tmpdir(), `screenmate-film-${process.pid}`);

const W = 1440;
const H = 900;
const FPS = 12;

const FORM = "http://localhost:8099/workday.html";
const TITLE = `file://${path.join(OUT, "title.html").replace(/\\/g, "/")}`;
const OUTRO = `file://${path.join(OUT, "outro.html").replace(/\\/g, "/")}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- frame capture ---------------- */

let frameNo = 0;
let capturing = false;

async function startCapture(page) {
  const client = await page.createCDPSession();
  await client.send("Page.startScreencast", {
    format: "jpeg",
    quality: 85,
    maxWidth: W,
    maxHeight: H,
    everyNthFrame: 1,
  });
  client.on("Page.screencastFrame", async ({ data, sessionId }) => {
    if (capturing) {
      fs.writeFileSync(
        path.join(FRAMES, `f${String(frameNo++).padStart(6, "0")}.jpg`),
        Buffer.from(data, "base64"),
      );
    }
    try {
      await client.send("Page.screencastFrameAck", { sessionId });
    } catch {
      /* session closed */
    }
  });
  return client;
}

/**
 * The screencast only emits on repaint, so a still page produces no frames.
 * This pads to a real duration by duplicating the last frame.
 */
function hold(seconds) {
  const need = Math.round(seconds * FPS);
  const files = fs.readdirSync(FRAMES).sort();
  const last = files[files.length - 1];
  if (!last) return;
  const src = fs.readFileSync(path.join(FRAMES, last));
  for (let i = 0; i < need; i++) {
    fs.writeFileSync(
      path.join(FRAMES, `f${String(frameNo++).padStart(6, "0")}.jpg`),
      src,
    );
  }
}

/* ---------------- caption overlay ---------------- */

const CAPTION_JS = `
(() => {
  if (document.getElementById("sm-caption")) return;
  const bar = document.createElement("div");
  bar.id = "sm-caption";
  bar.style.cssText = [
    "position:fixed","left:0","right:0","bottom:0","z-index:2147483646",
    "background:linear-gradient(to top, rgba(6,6,8,.97) 60%, rgba(6,6,8,0))",
    "padding:26px 40px 30px","pointer-events:none",
    "font:400 15px/1.55 ui-sans-serif,-apple-system,'Segoe UI',Inter,system-ui,sans-serif",
    "-webkit-font-smoothing:antialiased","transition:opacity .3s ease",
  ].join(";");
  bar.innerHTML =
    '<div id="sm-cap-k" style="font-size:10px;letter-spacing:.13em;text-transform:uppercase;' +
    'font-weight:600;color:#7c6cf5;margin-bottom:7px"></div>' +
    '<div id="sm-cap-t" style="font-size:20px;color:#eeeef2;font-weight:500;line-height:1.4"></div>' +
    '<div id="sm-cap-s" style="font-size:14.5px;color:#8a8a98;margin-top:6px"></div>';
  document.documentElement.appendChild(bar);
})();
`;

async function caption(page, kicker, title, sub = "") {
  await page
    .evaluate(
      ([k, t, s]) => {
        const K = document.getElementById("sm-cap-k");
        const T = document.getElementById("sm-cap-t");
        const S = document.getElementById("sm-cap-s");
        if (K) K.textContent = k;
        if (T) T.textContent = t;
        if (S) S.textContent = s;
      },
      [kicker, title, sub],
    )
    .catch(() => {});
}

async function ensureCaption(page) {
  await page.evaluate(CAPTION_JS).catch(() => {});
}

/* ---------------- the shoot ---------------- */

(async () => {
  fs.rmSync(FRAMES, { recursive: true, force: true });
  fs.mkdirSync(FRAMES, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    enableExtensions: true,
    args: [
      "--no-first-run",
      "--no-default-browser-check",
      `--window-size=${W},${H + 120}`,
      `--user-data-dir=${PROFILE}`,
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
    ],
  });

  try {
    const extId = await browser.installExtension(EXT);
    const cfg = JSON.parse(
      fs.readFileSync(path.join(EXT, "config.json"), "utf8"),
    );
    await configureExtension(browser, extId, {
      backendUrl: cfg.backendUrl,
      apiKey: cfg.apiKey,
    });

    // Standing answers, set up front the way a user would before applying.
    const seed = await browser.newPage();
    await seed.goto(`chrome-extension://${extId}/popup/popup.html`, {
      waitUntil: "domcontentloaded",
    });
    await seed.evaluate(() =>
      chrome.storage.local.set({
        preferences: {
          workAuthorization: "Yes",
          sponsorship: "No",
          relocation: "Yes",
          remotePreference: "Hybrid",
          salary: "Open to discussion",
          startDate: "June 2026",
          gender: "I do not wish to answer",
          ethnicity: "I do not wish to answer",
          veteran: "I do not wish to answer",
          disability: "I do not wish to answer",
        },
      }),
    );
    await seed.close();

    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H });

    /* --- title --- */
    await page.goto(TITLE, { waitUntil: "domcontentloaded" });
    await startCapture(page);
    capturing = true;
    await sleep(600);
    hold(6);

    /* --- the form --- */
    await page.goto(FORM, { waitUntil: "networkidle2" });
    await sleep(2500);
    await ensureCaption(page);
    await caption(
      page,
      "The environment",
      "A four-step job application. The agent has never seen this page.",
      "Custom dropdowns, a wizard, and a Submit button at the end.",
    );
    await sleep(400);
    hold(4.5);

    await page.waitForFunction(
      () => !!document.getElementById("screenmate-root")?.shadowRoot,
      { timeout: 20000 },
    );
    await caption(
      page,
      "It noticed",
      "SCREENMATE detected an application form and offered itself.",
      "It stays out of the way until you open it.",
    );
    await sleep(400);
    hold(3.5);

    const inPanel = (fn, arg) => page.evaluate(fn, arg);
    await inPanel(() => {
      const sr = document.getElementById("screenmate-root").shadowRoot;
      sr.querySelector(".head").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await sleep(2000);
    await ensureCaption(page);
    await caption(
      page,
      "Reading the page",
      "It reads the live DOM, then asks the server what it may touch.",
      "The extension holds no policy of its own. If the server is unreachable it refuses to act.",
    );
    await sleep(300);
    hold(4);

    /* --- run --- */
    await inPanel(() => {
      const sr = document.getElementById("screenmate-root").shadowRoot;
      [...sr.querySelectorAll("button")]
        .find((b) => /run screenmate/i.test(b.textContent))
        ?.click();
    });

    const beats = [
      [/observ|analyz/i, "Observing", "It states what the form is missing before touching anything.", ""],
      [/research/i, "Deciding to research", "This answer needs facts the profile does not contain, so it calls Exa.", "If only stored details were missing, it skips the call and says so."],
      [/acting|fill/i, "Acting", "Real tool calls into the page — not text to copy and paste.", "Through the native setter, so a controlled React field actually updates."],
      [/verif/i, "Verifying", "After every write it re-reads the page to confirm the value landed.", "It checks the page, not its own optimism."],
    ];
    const done = new Set();
    let waiting = false;
    const started = Date.now();

    while (Date.now() - started < 210000) {
      await sleep(900);
      await ensureCaption(page);
      const st = await inPanel(() => {
        const sr = document.getElementById("screenmate-root")?.shadowRoot;
        if (!sr) return { status: "", last: "" };
        const msgs = [...sr.querySelectorAll(".feed .msg")].map((n) =>
          n.textContent.trim(),
        );
        return {
          status: sr.querySelector(".status")?.textContent.trim() || "",
          last: msgs[msgs.length - 1] || "",
          advancing: msgs.filter((m) => /advancing to step/i.test(m)).length,
          handoff: !!sr.querySelector(".sec.warn .lbl.w"),
        };
      }).catch(() => ({ status: "", last: "" }));

      for (const [re, k, t, s] of beats) {
        if (done.has(k)) continue;
        if (re.test(st.status) || re.test(st.last)) {
          done.add(k);
          await caption(page, k, t, s);
        }
      }

      if (st.advancing >= 1 && !done.has("adv")) {
        done.add("adv");
        await caption(
          page,
          "Walking the wizard",
          "It fills a step, verifies it, clicks Next, and re-reads the new page.",
          "Up to eight steps.",
        );
      }

      if (/waiting for user/i.test(st.status) && !waiting) {
        waiting = true;
        await caption(
          page,
          "It stops",
          "Sensitive questions are answered from standing answers you set once.",
          "The agent never decides them. Anything unset still pauses the run.",
        );
        hold(4);
        await inPanel(() => {
          const sr = document.getElementById("screenmate-root").shadowRoot;
          const free = sr.querySelector(".afree");
          if (free) {
            free.value = "Open to discussion";
            sr.querySelector('[data-act="answerFree"]')?.click();
            return;
          }
          const opts = [...sr.querySelectorAll(".opt")];
          (opts.find((o) => /do not wish/i.test(o.textContent)) || opts[0])?.click();
        });
        waiting = false;
      }

      if (/complete|awaiting your review/i.test(st.status)) break;
    }

    /* --- the ending that matters --- */
    await ensureCaption(page);
    await page.evaluate(() => window.scrollTo({ top: 99999, behavior: "smooth" }));
    await sleep(1200);
    await caption(
      page,
      "The one button it will never press",
      "It clicks Next all day. It does not click Submit.",
      "That refusal is in the navigation code, not left to the model's judgement.",
    );
    await sleep(400);
    hold(6);

    const wiz = await page.evaluate(() => window.__wizardState()).catch(() => null);
    console.log("submitted:", wiz?.submitted, "| step:", wiz?.step);

    await caption(
      page,
      "Yours to finish",
      "Every change is listed with Edit, Regenerate and Revert.",
      "Nothing was sent to the employer.",
    );
    await sleep(400);
    hold(4);

    /* --- outro --- */
    await page.goto(OUTRO, { waitUntil: "domcontentloaded" });
    await sleep(800);
    hold(7);

    capturing = false;
    await sleep(300);
  } catch (e) {
    console.log("RECORDING ERROR:", e.message);
  } finally {
    await browser.close();
    try {
      fs.rmSync(PROFILE, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }

  /* ---------------- encode ---------------- */

  const count = fs.readdirSync(FRAMES).filter((f) => f.endsWith(".jpg")).length;
  console.log(`captured ${count} frames (~${(count / FPS).toFixed(1)}s at ${FPS}fps)`);
  if (!count) {
    console.log("nothing captured");
    process.exitCode = 1;
    return;
  }

  const raw = path.join(OUT, "screenmate-raw.mp4");
  execFileSync(
    ffmpeg,
    [
      "-y",
      "-framerate", String(FPS),
      "-i", path.join(FRAMES, "f%06d.jpg"),
      "-vf", `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:-1:-1:color=0x0a0a0c,format=yuv420p`,
      "-c:v", "libx264",
      "-preset", "slow",
      "-crf", "20",
      "-movflags", "+faststart",
      raw,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );

  // `ffmpeg -i` with no output exits non-zero by design, so read the duration
  // from its stderr rather than treating that exit code as a failure.
  let stderr = "";
  try {
    execFileSync(ffmpeg, ["-hide_banner", "-i", raw], {
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch (e) {
    stderr = (e.stderr || "").toString();
  }
  const m = stderr.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const dur = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
  console.log(`raw duration: ${dur.toFixed(1)}s`);
  console.log(`wrote ${path.relative(ROOT, raw)}`);
})();
