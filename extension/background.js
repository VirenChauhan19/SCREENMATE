/**
 * SCREENMATE service worker.
 *
 * All network calls go through here rather than the content script, for two
 * reasons: the page's CORS policy doesn't apply to fetches made with the
 * extension's host permissions, and a compromised page can never see the
 * backend URL or read a response it wasn't given.
 */

const DEFAULT_BACKEND = "http://localhost:3000";

/**
 * A new install starts with an empty profile, not a sample one: whatever sits
 * here gets typed into real applications under the user's name.
 */
const EMPTY_PROFILE = {
  name: "",
  email: "",
  phone: "",
  location: "",
  country: "",
  university: "",
  degree: "",
  minor: "",
  graduationDate: "",
  currentCompany: "",
  currentTitle: "",
  portfolio: "",
  linkedin: "",
  github: "",
  skills: [],
};

/**
 * Values an earlier build seeded as a sample profile. They are not anyone's
 * real details, so an install still carrying them has them removed rather
 * than submitted to employers.
 */
const PLACEHOLDERS = {
  email: "viren@example.com",
  linkedin: "https://linkedin.com/in/example",
};

/**
 * A build packaged for someone else carries config.json, so the recipient does
 * not have to type a URL and key before anything works. It is absent from a
 * repo checkout, where localhost is the right default.
 */
async function bundledConfig() {
  try {
    const res = await fetch(chrome.runtime.getURL("config.json"));
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

const isLocal = (url) => {
  if (!url) return true;
  try { return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname); }
  catch { return false; }
};

/**
 * Seeds settings on install, and repairs them on update.
 *
 * The repair matters: an install that already saved `localhost` keeps pointing
 * at a server that is not running, and no amount of re-seeding fixes it while
 * the check is "only if unset". A stored localhost URL was never a deliberate
 * choice, so a bundled backend supersedes it. A URL the user actually typed is
 * left alone.
 */
async function applyConfig() {
  const stored = await chrome.storage.local.get([
    "profile",
    "backendUrl",
    "apiKey",
    "backendConfigured",
  ]);
  const bundled = await bundledConfig();
  const patch = {};

  if (!stored.profile) {
    patch.profile = { ...EMPTY_PROFILE, ...(bundled?.profile || {}) };
  } else {
    const cleaned = { ...stored.profile };
    let changed = false;
    for (const [key, sample] of Object.entries(PLACEHOLDERS)) {
      if (cleaned[key] === sample) {
        cleaned[key] = "";
        changed = true;
      }
    }
    if (changed) patch.profile = cleaned;
  }

  if (bundled?.backendUrl && !stored.backendConfigured && isLocal(stored.backendUrl)) {
    patch.backendUrl = bundled.backendUrl;
    if (bundled.apiKey) patch.apiKey = bundled.apiKey;
  } else if (!stored.backendUrl) {
    patch.backendUrl = DEFAULT_BACKEND;
  }

  if (bundled?.apiKey && !stored.apiKey) patch.apiKey = bundled.apiKey;

  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
  return patch;
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await applyConfig();
  // First install: the profile is empty, so start where it gets filled in.
  if (reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("options/options.html#welcome") });
  }
});
// Also on browser start, so an extension left pointing at a dead localhost from
// an earlier session repairs itself without the user touching anything.
chrome.runtime.onStartup?.addListener(applyConfig);

async function backendConfig() {
  const { backendUrl, apiKey } = await chrome.storage.local.get([
    "backendUrl",
    "apiKey",
  ]);
  return {
    base: (backendUrl || DEFAULT_BACKEND).replace(/\/+$/, ""),
    apiKey: apiKey || "",
  };
}

async function callApi(path, body) {
  const { base, apiKey } = await backendConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const headers = { "Content-Type": "application/json" };
    // A hosted backend gates on this; a local one ignores it.
    if (apiKey) headers["x-screenmate-key"] = apiKey;

    const res = await fetch(base + path, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (res.status === 401) {
      return {
        ok: false,
        status: 401,
        error: "Backend access key missing or wrong",
        reason: "Open SCREENMATE's settings and paste the access key.",
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: data?.error || `Backend returned ${res.status}`,
        reason: data?.reason,
      };
    }
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error:
        err.name === "AbortError"
          ? "Backend request timed out"
          : "Cannot reach the SCREENMATE backend",
      reason: `Tried ${base}. Check your connection, or the server address in SCREENMATE's settings.`,
    };
  } finally {
    clearTimeout(timer);
  }
}

const ROUTES = {
  classify: "/api/classify",
  agent: "/api/agent",
  research: "/api/research",
};

/* ---------------- runs that cross a page load ---------------- */

/**
 * Some portals load a whole new page for each step of an application, which
 * ends the content script mid-run. The run leaves a note here, keyed by tab,
 * and the next page picks it up. Held in memory for speed and in session
 * storage in case this worker was stopped in between; gone when the browser
 * closes, and never older than a few minutes when used.
 */
const RUN_TTL = 3 * 60_000;
const runs = new Map();
/** Runs already picked up by a frame, so a second frame never resumes it too. */
const claimed = new Set();
const runKey = (tabId) => `run:${tabId}`;

function dropRun(key) {
  runs.delete(key);
  void chrome.storage.session.remove(key);
}

async function takeRun(tabId, sender) {
  const key = runKey(tabId);
  if (claimed.has(key)) return null;
  // In memory it is taken without a pause, so two frames cannot both win.
  const run = runs.get(key) || (await chrome.storage.session.get(key))[key];
  if (!run || claimed.has(key)) return null;
  if (Date.now() - run.at > RUN_TTL) {
    dropRun(key);
    return null;
  }
  let origin = "";
  try {
    origin = new URL(sender.url).origin;
  } catch {
    /* no URL: not the frame that owns this run */
  }
  if (origin !== run.origin || sender.frameId !== run.frameId ||
      (run.documentId && sender.documentId === run.documentId) || !(run.resume || run.submitPending)) return null;
  claimed.add(key);
  dropRun(key);
  return run;
}

chrome.tabs.onRemoved.addListener((tabId) => {
  claimed.delete(runKey(tabId));
  dropRun(runKey(tabId));
});

/* ---------------- messages ---------------- */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "screenmate:api") {
    const path = ROUTES[msg.route];
    if (!path) {
      sendResponse({ ok: false, error: `Unknown route "${msg.route}"` });
      return false;
    }
    callApi(path, msg.body).then(sendResponse, () => sendResponse({ ok: false, error: "Could not read backend settings. Reopen extension settings and try again." }));
    return true; // keep the channel open for the async reply
  }

  // Wakes the backend before the first real request. A hosted function that
  // has gone idle takes seconds to boot; an OPTIONS preflight starts it
  // without spending a model or search credit, so Run does not pay for it.
  if (msg?.type === "screenmate:warm") {
    backendConfig().then(({ base }) => {
      for (const path of Object.values(ROUTES)) {
        fetch(base + path, { method: "OPTIONS" }).catch(() => {});
      }
    });
    sendResponse(true);
    return false;
  }

  const tabId = sender.tab?.id;

  // A form in an iframe has its panel drawn by the top page. State goes up to
  // frame 0, your clicks come back down to the frame running the form; both
  // through here, where the page cannot listen in or forge a click.
  if (msg?.type === "screenmate:panel") {
    if (tabId == null) {
      sendResponse(null);
      return false;
    }
    if (msg.to !== "top" && sender.frameId !== 0) {
      sendResponse(null);
      return false;
    }
    const to =
      msg.to === "top" ? { frameId: 0 } : Number.isInteger(msg.frameId) ? { frameId: msg.frameId } : null;
    if (!to) {
      sendResponse(null);
      return false;
    }
    const relayed = msg.to === "top" ? { ...msg, frameId: sender.frameId } : msg;
    chrome.tabs.sendMessage(tabId, relayed, to).then(
      (r) => sendResponse(r ?? null),
      () => sendResponse(null),
    );
    return true;
  }

  if (msg?.type === "screenmate:saveRun") {
    if (tabId == null || !msg.run) {
      sendResponse(false);
      return false;
    }
    const key = runKey(tabId);
    let origin;
    try { origin = new URL(sender.url).origin; } catch { sendResponse(false); return false; }
    const run = { ...msg.run, origin, frameId: sender.frameId, documentId: sender.documentId, at: Date.now() };
    // A fresh note: the next page may pick it up again.
    claimed.delete(key);
    runs.set(key, run);
    chrome.storage.session.set({ [key]: run }).then(
      () => sendResponse(true),
      () => sendResponse(true),
    );
    return true;
  }

  if (msg?.type === "screenmate:loadRun") {
    if (tabId == null) {
      sendResponse(null);
      return false;
    }
    takeRun(tabId, sender).then(sendResponse, () => sendResponse(null));
    return true;
  }

  if (msg?.type === "screenmate:clearRun") {
    if (tabId != null) dropRun(runKey(tabId));
    sendResponse(true);
    return false;
  }

  if (msg?.type === "screenmate:openSettings") {
    chrome.runtime.openOptionsPage();
    sendResponse(true);
    return false;
  }

  // CV upload is deliberately NOT proxied here: an MV3 service worker cannot
  // fetch a data: URL, and multipart has no reason to make the extra hop. The
  // settings page is an extension page with the same host permissions, so it
  // posts the File straight to the backend.
  // The popup asks for this on open, so a stale localhost is repaired the
  // moment someone looks at the extension rather than at the next restart.
  if (msg?.type === "screenmate:applyConfig") {
    applyConfig().then(sendResponse);
    return true;
  }

  if (msg?.type === "screenmate:getBackend") {
    backendConfig().then(sendResponse);
    return true;
  }

  if (msg?.type === "screenmate:getProfile") {
    chrome.storage.local.get(["profile", "backendUrl", "apiKey"]).then((s) =>
      sendResponse({
        profile: s.profile || EMPTY_PROFILE,
        backendUrl: s.backendUrl || DEFAULT_BACKEND,
        hasKey: Boolean(s.apiKey),
      }),
    );
    return true;
  }

  return false;
});

/* ---------------- opening the panel ---------------- */

const CONTENT_SCRIPTS = [
  "content/scan.js",
  "content/act.js",
  "content/nav.js",
  "content/prefs.js",
  "content/panel.js",
  "content/frames.js",
  "content/main.js",
];

/**
 * Opens (or folds) the panel in a tab. A page that was open before the
 * extension was installed or updated has no content script yet, so it is
 * added first.
 */
async function togglePanel(tabId, type = "screenmate:toggle") {
  try {
    await chrome.tabs.sendMessage(tabId, { type });
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: CONTENT_SCRIPTS,
      });
      await chrome.tabs.sendMessage(tabId, { type: "screenmate:open" });
    } catch {
      /* a page extensions may not touch (the Web Store, chrome://) */
    }
  }
}

// Alt+Shift+S: the panel without reaching for the mouse.
chrome.commands?.onCommand.addListener(async (command) => {
  if (command !== "toggle-panel") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) await togglePanel(tab.id);
});

// Clicking the toolbar icon with the popup open is handled by the popup itself;
// this covers the keyboard-invoked case.
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) void togglePanel(tab.id);
});
