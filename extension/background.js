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

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(["profile", "backendUrl"]);
  const patch = {};
  if (!stored.profile) patch.profile = DEFAULT_PROFILE;
  if (!stored.backendUrl) patch.backendUrl = DEFAULT_BACKEND;
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
});

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

/**
 * CV upload needs multipart rather than JSON, so it does not go through
 * callApi. The bytes are sent straight through and never stored by the
 * extension — only the extracted profile comes back.
 */
async function parseCv({ name, type, dataUrl }) {
  const { base, apiKey } = await backendConfig();
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const form = new FormData();
    form.append("cv", new File([blob], name, { type }));

    const headers = {};
    if (apiKey) headers["x-screenmate-key"] = apiKey;

    const res = await fetch(`${base}/api/parse-cv`, {
      method: "POST",
      headers,
      body: form,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        ok: false,
        error: data?.error || `Backend returned ${res.status}`,
        reason: data?.reason,
      };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, error: "Could not reach the backend to read that CV." };
  }
}

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

  if (msg?.type === "screenmate:parseCv") {
    parseCv(msg.file).then(sendResponse);
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
