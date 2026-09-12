/**
 * SCREENMATE service worker.
 *
 * All network calls go through here rather than the content script, for two
 * reasons: the page's CORS policy doesn't apply to fetches made with the
 * extension's host permissions, and a compromised page can never see the
 * backend URL or read a response it wasn't given.
 */

const DEFAULT_BACKEND = "http://localhost:3000";

const DEFAULT_PROFILE = {
  name: "Viren Chauhan",
  email: "viren@example.com",
  university: "SCAD",
  degree: "BFA Game Design",
  minor: "Applied AI",
  graduationDate: "2027",
  portfolio: "https://virenchauhan.com",
  linkedin: "https://linkedin.com/in/example",
  location: "Atlanta, Georgia",
  skills: [
    "React",
    "TypeScript",
    "Python",
    "Unreal Engine",
    "Unity",
    "AI integrations",
  ],
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

const isLocal = (url) => !url || /localhost|127\.0\.0\.1/.test(url);

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
  }
}

const ROUTES = {
  classify: "/api/classify",
  agent: "/api/agent",
  research: "/api/research",
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
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
    chrome.storage.local.get(["profile", "backendUrl", "apiKey"]).then((s) =>
      sendResponse({
        profile: s.profile || DEFAULT_PROFILE,
        backendUrl: s.backendUrl || DEFAULT_BACKEND,
        hasKey: Boolean(s.apiKey),
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
