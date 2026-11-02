/**
 * SCREENMATE service worker.
 *
 * All network calls go through here rather than the content script, for two
 * reasons: the page's CORS policy doesn't apply to fetches made with the
 * extension's host permissions, and a compromised page can never see the
 * backend URL or read a response it wasn't given.
 */

const DEFAULT_BACKEND = "http://localhost:3000";

const DEFAULT_PROFILE = { name: "", email: "", skills: [] };
const PROFILE_CONTEXT_KEYS = ["professionalSummary", "experience", "projects"];
const PROFILE_KEYS = ["name", "firstName", "lastName", "email", "phone", "location", "city", "state", "postalCode", "addressLine1", "addressLine2", "country", "university", "degree", "fieldOfStudy", "minor", "graduationDate", "portfolio", "linkedin", "github", ...PROFILE_CONTEXT_KEYS];

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
  ]);
  const bundled = await bundledConfig();
  const patch = {};

  if (!stored.profile) patch.profile = bundled?.profile || DEFAULT_PROFILE;

  if (bundled?.backendUrl && isLocal(stored.backendUrl)) {
    patch.backendUrl = bundled.backendUrl;
  } else if (!stored.backendUrl) {
    patch.backendUrl = DEFAULT_BACKEND;
  }

  if (bundled?.apiKey && !stored.apiKey) patch.apiKey = bundled.apiKey;

  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
  return patch;
}

chrome.runtime.onInstalled.addListener(applyConfig);
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
  // Personalized answers may need generation, a bounded length revision, and
  // source review before any write is authorized. Other routes remain shorter.
  let keepAlive = null;
  const timer = setTimeout(() => {
    controller.abort();
    if (keepAlive !== null) clearInterval(keepAlive);
  }, path === '/api/agent' ? 270_000 : 60_000);
  // Chrome's documented long-operation exception: keep this request alive,
  // never the idle worker. The hard deadline also stops the heartbeat.
  if (path === '/api/agent') keepAlive = setInterval(() => {
    try { chrome.runtime.getPlatformInfo(() => { void chrome.runtime.lastError; }); } catch { /* Extension may be unloading. */ }
  }, 25_000);
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
        reason: "Open the SCREENMATE popup and paste the access key.",
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
      reason: `Tried ${base}. Check the backend URL in the popup.`,
    };
  } finally {
    clearTimeout(timer);
    if (keepAlive !== null) clearInterval(keepAlive);
  }
}

const ROUTES = {
  classify: "/api/classify",
  agent: "/api/agent",
  research: "/api/research",
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // Only the configured SCREENMATE website may send a profile. Employer pages
  // cannot read settings, replace a profile, or obtain an access key here.
  if (msg?.type === "screenmate:website") {
    (async () => {
      const config = await backendConfig();
      if (_sender.frameId !== 0 || !_sender.url || new URL(_sender.url).origin !== new URL(config.base).origin) {
        return { ok: false, error: "This website is not the configured SCREENMATE server." };
      }
      if (msg.action === "ping") return { ok: true };
      if (msg.action !== "saveProfile" || !msg.profile || typeof msg.profile !== "object") return { ok: false, error: "Invalid profile." };
      const profile = {};
      for (const key of PROFILE_KEYS) {
        const value = msg.profile[key] ?? "";
        if (typeof value !== "string" || value.length > (PROFILE_CONTEXT_KEYS.includes(key) ? 6000 : 500)) return { ok: false, error: "Invalid profile field." };
        profile[key] = value.trim();
      }
      if (!profile.name || !profile.email) return { ok: false, error: "Add your name and email first." };
      if (!Array.isArray(msg.profile.skills) || msg.profile.skills.length > 60 || msg.profile.skills.some(value => typeof value !== "string" || value.length > 100)) return { ok: false, error: "Invalid skills." };
      profile.skills = msg.profile.skills.map(value => value.trim()).filter(Boolean);
      await chrome.storage.local.set({ profile, profileConfirmed: true });
      return { ok: true };
    })().then(sendResponse).catch(() => sendResponse({ ok: false, error: "Could not connect to the extension." }));
    return true;
  }
  if (msg?.type === "screenmate:api") {
    const path = ROUTES[msg.route];
    if (!path) {
      sendResponse({ ok: false, error: `Unknown route "${msg.route}"` });
      return false;
    }
    callApi(path, msg.body).then(sendResponse);
    return true; // keep the channel open for the async reply
  }

  // CV upload is deliberately NOT proxied here: an MV3 service worker cannot
  // fetch a data: URL, and multipart has no reason to make the extra hop. The
  // popup is an extension page with the same host permissions, so it posts the
  // File straight to the backend.
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
    chrome.storage.local.get(["profile", "backendUrl", "apiKey", "profileConfirmed"]).then((s) =>
      sendResponse({
        profile: s.profile || DEFAULT_PROFILE,
        backendUrl: s.backendUrl || DEFAULT_BACKEND,
        hasKey: Boolean(s.apiKey),
        profileConfigured: Boolean(s.profile?.name?.trim() && s.profile?.email?.trim() &&
          (s.profileConfirmed || s.profile.email !== "viren@example.com")),
      }),
    );
    return true;
  }

  return false;
});

// Clicking the toolbar icon with the popup open is handled by the popup itself;
// this covers the keyboard-invoked case.
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.tabs.sendMessage(tab.id, { type: "screenmate:toggle" }).catch(() => {});
  }
});
