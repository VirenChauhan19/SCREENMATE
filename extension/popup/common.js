/**
 * Shared by the popup and the settings page: the backend check, and the
 * profile fields both of them show.
 */

/** Profile keys, in the order the settings page lists them. */
const SM_PROFILE_FIELDS = [
  "name", "email", "phone", "location", "country",
  "currentCompany", "currentTitle", "university", "degree",
  "minor", "graduationDate", "portfolio", "linkedin", "github", "experience",
];

/** The ones nearly every application asks for. */
const SM_ESSENTIAL = ["name", "email", "phone", "location"];

/** Sample values that are nobody's real details. */
const smIsPlaceholder = (key, value) =>
  Boolean(value) &&
  ((key === "email" && /@example\.(com|org|net)$/i.test(value)) ||
    (key === "linkedin" && /linkedin\.com\/in\/example\/?$/i.test(value)));

function smEsc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

/**
 * Reports the specific problem rather than a generic failure: unreachable,
 * missing credentials, and a wrong access key all need different fixes.
 */
const smHealthRequests = new WeakMap();
async function smHealth(base, apiKey, el) {
  smHealthRequests.get(el)?.abort();
  const controller = new AbortController();
  smHealthRequests.set(el, controller);
  const timeout = setTimeout(() => controller.abort(), 12000);
  const url = String(base || "").replace(/\/+$/, "");
  const set = (text, cls) => {
    if (smHealthRequests.get(el) !== controller) return;
    el.textContent = text;
    el.className = `note ${cls}`;
  };

  try {
    const res = await fetch(`${url}/api/health`, { signal: controller.signal });
    if (!res.ok) return set(`Backend returned ${res.status}.`, "bad");
    const h = await res.json();

    if (!h.configured.openrouter) {
      return set("Backend is up but has no OPENROUTER_API_KEY.", "bad");
    }
    if (h.requiresKey && !apiKey) {
      return set("Backend is up. It needs an access key — paste it in settings.", "bad");
    }

    if (h.requiresKey) {
      const probe = await fetch(`${url}/api/classify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-screenmate-key": apiKey },
        body: JSON.stringify({ fields: [] }),
        signal: controller.signal,
      });
      if (probe.status === 401) return set("Access key rejected.", "bad");
      if (!probe.ok) return set(`Backend returned ${probe.status}.`, "bad");
    }

    set(
      `Connected${h.configured.exa ? "" : " (no Exa key: research disabled)"}.`,
      h.configured.exa ? "ok" : "warn",
    );
  } catch {
    set(`Cannot reach ${url}. Check the address, or run \`npm run dev\` locally.`, "bad");
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * A custom https backend needs host permission before the worker can call it.
 * Call directly from the save button's click handler, before any awaits.
 */
function smEnsureHostPermission(backendUrl) {
  try {
    const url = new URL(backendUrl);
    if (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)) return Promise.resolve(true);
    // Start in the original click, before storage or network awaits lose the gesture.
    return chrome.permissions.request({ origins: [url.origin + "/*"] }).catch(() => false);
  } catch {
    return Promise.resolve(false);
  }
}
