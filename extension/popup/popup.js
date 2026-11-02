const PROFILE_CONTEXT_FIELDS = ["professionalSummary", "experience", "projects"];
const fieldLimit = key => PROFILE_CONTEXT_FIELDS.includes(key) ? 6000 : 500;
const FIELDS = [
  "name", "firstName", "lastName", "email", "phone", "location", "city", "state", "postalCode", "addressLine1", "addressLine2", "country", "university", "degree", "fieldOfStudy",
  "minor", "graduationDate", "portfolio", "linkedin", "github",
  ...PROFILE_CONTEXT_FIELDS,
];

async function load() {
  // Repair first: an install still pointing at a dead localhost should fix
  // itself when you open the popup, not leave you to work out why nothing works.
  await new Promise((r) =>
    chrome.runtime.sendMessage({ type: "screenmate:applyConfig" }, () => r()),
  );

  const {
    profile = {},
    backendUrl = "http://localhost:3000",
    apiKey = "",
  } = await chrome.storage.local.get(["profile", "backendUrl", "apiKey"]);
  for (const f of FIELDS) {
    const input = document.getElementById(f);
    input.value = profile[f] || "";
    input.maxLength = fieldLimit(f);
  }
  document.getElementById("skills").value = (profile.skills || []).join(", ");
  document.getElementById("backendUrl").value = backendUrl;
  document.getElementById("apiKey").value = apiKey;
  void renderImportNote();
  void health(backendUrl, apiKey);
}

/**
 * Reports the specific problem rather than a generic failure: unreachable,
 * missing credentials, and a wrong access key all need different fixes.
 */
async function health(base, apiKey) {
  const el = document.getElementById("health");
  const url = base.replace(/\/+$/, "");
  const set = (text, cls) => {
    el.textContent = text;
    el.className = `note ${cls}`;
  };

  try {
    const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return set(`Backend returned ${res.status}.`, "bad");
    const h = await res.json();
    if (h.service !== "screenmate" || !h.configured) return set("This address is not a SCREENMATE server.", "bad");

    if (!h.configured.openrouter) {
      return set("Backend is up but has no OPENROUTER_API_KEY.", "bad");
    }
    if (h.requiresKey && !apiKey) {
      return set("Backend is up. It needs an access key — paste it below.", "bad");
    }

    if (h.requiresKey) {
      const probe = await fetch(`${url}/api/classify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-screenmate-key": apiKey },
        body: JSON.stringify({ fields: [] }),
        signal: AbortSignal.timeout(10000),
      });
      if (probe.status === 401) return set("Access key rejected.", "bad");
      if (!probe.ok) return set(`Backend returned ${probe.status}.`, "bad");
    }

    set(
      `Connected${h.configured.exa ? "" : " (no Exa key: research disabled)"}.`,
      h.configured.exa ? "ok" : "bad",
    );
  } catch {
    set(`Cannot reach ${url}. Check the URL, or run \`npm run dev\` locally.`, "bad");
  }
}

/** One writer for the profile, used by Save and by CV Apply. */
async function saveProfile(extra = {}) {
  // Preserve imported facts that do not have an editor in this popup.
  const { profile: stored = {} } = await chrome.storage.local.get('profile');
  const profile = { ...stored };
  for (const f of FIELDS) profile[f] = document.getElementById(f).value.trim();
  profile.skills = document
    .getElementById("skills")
    .value.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const patch = { profile, profileConfirmed: true };
  if (extra.cvName) {
    patch.cvImport = { name: extra.cvName, at: new Date().toISOString() };
  }
  await chrome.storage.local.set(patch);
}

/** Reminds you what the profile came from, so you do not re-upload out of doubt. */
async function renderImportNote() {
  const { cvImport } = await chrome.storage.local.get("cvImport");
  const el = document.getElementById("cvImported");
  if (!el) return;
  if (!cvImport) {
    el.textContent = "";
    return;
  }
  const when = new Date(cvImport.at);
  el.textContent =
    `Saved from ${cvImport.name} on ` +
    `${when.toLocaleDateString()}. Your profile is stored on this device ` +
    `— you do not need to upload it again.`;
  el.className = "note ok";
}

document.getElementById("save").addEventListener("click", async () => {
  await saveProfile();
  const btn = document.getElementById("save");
  btn.textContent = "Saved";
  setTimeout(() => (btn.textContent = "Save profile"), 1200);
});

/**
 * A custom https backend needs host permission before the worker can call it.
 * Request it directly from the Save click, before any storage or network await.
 */
function ensureHostPermission(backendUrl) {
  // Must be invoked in the original click gesture, before any await.
  return chrome.permissions.request({ origins: [new URL(backendUrl).origin + "/*"] });
}

document.getElementById("saveUrl").addEventListener("click", async () => {
  const btn = document.getElementById("saveUrl");
  const status = document.getElementById("health");
  try {
    const parsed = new URL(document.getElementById("backendUrl").value.trim());
    const local = ["localhost", "127.0.0.1"].includes(parsed.hostname);
    if ((parsed.protocol !== "https:" && !(parsed.protocol === "http:" && local)) || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      throw new Error("Use an HTTPS server origin, or a localhost URL for development.");
    }
    const permission = ensureHostPermission(parsed.origin);
    btn.disabled = true;
    if (!await permission) throw new Error("Server access was not allowed. Settings were not changed.");
    const backendUrl = parsed.origin;
    const apiKey = document.getElementById("apiKey").value.trim();
    await chrome.storage.local.set({ backendUrl, apiKey });
    document.getElementById("backendUrl").value = backendUrl;
    btn.textContent = "Saved";
    setTimeout(() => (btn.textContent = "Save backend settings"), 1200);
    await health(backendUrl, apiKey);
  } catch (error) {
    status.textContent = error.message || "Could not save backend settings.";
    status.className = "note bad";
  } finally { btn.disabled = false; }
});

document.getElementById("open").addEventListener("click", async () => {
  const status = document.getElementById("health");
  try {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "screenmate:open" });
  } catch {
    // Content script not present (page loaded before install) — inject now.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: [
        "content/connect.js",
        "content/scan.js",
        "content/act.js",
        "content/nav.js",
        "content/prefs.js",
        "content/panel.js",
        "content/main.js",
      ],
    });
    await chrome.tabs.sendMessage(tab.id, { type: "screenmate:open" });
  }
  window.close();
  } catch {
    status.textContent = "SCREENMATE cannot open here. Open an employer’s application page and try again.";
    status.className = "note bad";
  }
});

document.getElementById("profileFile").addEventListener("change", async (event) => {
  const status = document.getElementById("profileImportStatus");
  try {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 256000) throw new Error("This profile file is too large.");
    const data = JSON.parse(await file.text());
    if (data.version !== 1 || !data.profile || typeof data.profile !== "object") throw new Error("Choose a SCREENMATE profile JSON file.");
    for (const key of FIELDS) {
      const value = data.profile[key];
      if (value !== undefined && (typeof value !== "string" || value.length > fieldLimit(key))) throw new Error("Invalid profile field.");
    }
    const skills = data.profile.skills || [];
    if (!Array.isArray(skills) || skills.length > 60 || skills.some(value => typeof value !== "string" || value.length > 100)) throw new Error("Invalid skills.");
    for (const key of FIELDS) document.getElementById(key).value = data.profile[key] || "";
    document.getElementById("skills").value = skills.join(", ");
    status.textContent = "Profile loaded below. Review the details, then choose Save profile.";
    status.className = "note ok";
  } catch (error) { status.textContent = error.message || "Could not import this profile."; status.className = "note bad"; }
  finally { event.target.value = ""; }
});

/* ---------------- CV import ---------------- */

const CV_KEYS = [
  ["firstName", "First name"], ["lastName", "Last name"],
  ["city", "City"], ["state", "State / province"], ["country", "Country"], ["postalCode", "Postal code"],
  ["addressLine1", "Street address"], ["addressLine2", "Address line 2"], ["fieldOfStudy", "Field of study"], ["github", "GitHub"],
  ["name", "Name"], ["email", "Email"], ["phone", "Phone"], ["location", "Location"],
  ["university", "University"], ["degree", "Degree"], ["minor", "Minor"],
  ["graduationDate", "Graduation"], ["portfolio", "Portfolio"],
  ["linkedin", "LinkedIn"], ["skills", "Skills"],
  ["professionalSummary", "Professional summary"], ["experience", "Work experience"], ["projects", "Projects"],
];

/**
 * Uploads straight from the popup.
 *
 * This used to hop through the service worker as a data: URL, which an MV3
 * worker cannot fetch — every CV failed with a misleading "could not reach the
 * backend". The popup already has the host permissions, so it posts the File
 * itself and reports what actually went wrong.
 */
async function uploadCv(file) {
  const { base, apiKey } = await new Promise((r) =>
    chrome.runtime.sendMessage({ type: "screenmate:getBackend" }, r),
  );

  if (!base) {
    return { ok: false, error: "No backend URL set. Add one below." };
  }

  const form = new FormData();
  form.append("cv", file, file.name);

  const headers = {};
  if (apiKey) headers["x-screenmate-key"] = apiKey;

  // A hosted function that has gone cold can drop the first request; PDF
  // parsing boots a whole PDF engine, so this one is slow to wake. One retry
  // turns a confusing failure on someone's first upload into a short wait.
  const url = `${base.replace(/\/+$/, "")}/api/parse-cv`;
  let res = null;
  let lastError = null;

  for (let attempt = 0; attempt < 2 && !res; attempt++) {
    if (attempt) {
      const el = document.getElementById("cvStatus");
      if (el) {
        el.textContent = "Waking the server, one moment…";
        el.className = "note";
      }
      await new Promise((r) => setTimeout(r, 1200));
    }
    try {
      res = await fetch(url, { method: "POST", headers, body: form });
    } catch (err) {
      lastError = err;
    }
  }

  if (!res) {
    return {
      ok: false,
      error: `Could not reach ${base}.`,
      reason: lastError
        ? "Check the backend URL below, or that the server is running."
        : "",
    };
  }

  const data = await res.json().catch(() => null);
  if (res.status === 401) {
    return {
      ok: false,
      error: "Backend rejected the access key.",
      reason: "Check the access key below.",
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      error: data?.error || `Backend returned ${res.status}.`,
      reason: data?.reason,
    };
  }
  return { ok: true, data };
}

document.getElementById("cvGo").addEventListener("click", async () => {
  const input = document.getElementById("cvFile");
  const status = document.getElementById("cvStatus");
  const diff = document.getElementById("cvDiff");
  const file = input.files?.[0];
  diff.innerHTML = "";

  if (!file) {
    status.textContent = "Choose a CV file first.";
    status.className = "note bad";
    return;
  }

  status.textContent = `Reading ${file.name}…`;
  status.className = "note";

  const out = await uploadCv(file);

  if (!out.ok) {
    status.textContent = `${out.error}${out.reason ? ` ${out.reason}` : ""}`;
    status.className = "note bad";
    return;
  }

  // Show what would change and let the user apply or discard it. An extracted
  // profile should never silently overwrite something you typed.
  const p = out.data.profile;
  const rows = [];
  for (const [key, label] of CV_KEYS) {
    const incoming = key === "skills" ? (p.skills || []).join(", ") : p[key];
    if (!incoming) continue;
    const current =
      key === "skills"
        ? document.getElementById("skills").value
        : document.getElementById(key)?.value || "";
    if (current.trim() === String(incoming).trim()) continue;
    rows.push({ key, label, current, incoming: String(incoming) });
  }

  if (rows.length === 0) {
    status.textContent = `Read ${out.data.chars} characters. Nothing new to change.`;
    status.className = "note ok";
    return;
  }

  status.textContent = `Found ${rows.length} field${rows.length === 1 ? "" : "s"}${
    out.data.missing?.length ? ` · not in the CV: ${out.data.missing.join(", ")}` : ""
  }`;
  status.className = "note ok";

  diff.innerHTML =
    `<div class="diff">${rows
      .map(
        (r) =>
          `<div class="drow"><span class="dk">${r.label}</span><span class="dv">` +
          (r.current ? `<span class="dold">${esc(r.current)}</span><br>` : "") +
          `<span class="dnew">${esc(r.incoming)}</span></span></div>`,
      )
      .join("")}</div>` +
    `<button id="cvApply">Apply ${rows.length} change${rows.length === 1 ? "" : "s"}</button>` +
    `<button class="ghost" id="cvDiscard">Discard</button>`;

  document.getElementById("cvApply").addEventListener("click", async () => {
    for (const r of rows) {
      const el = document.getElementById(r.key === "skills" ? "skills" : r.key);
      if (el) el.value = r.incoming;
    }
    // Save straight away. Applying and then forgetting to press Save is the
    // easiest way to lose an import, and there is nothing to gain from the
    // extra click.
    await saveProfile({ cvName: file.name });
    diff.innerHTML = "";
    status.textContent = `Saved from ${file.name}. Edit anything below if it is wrong.`;
    status.className = "note ok";
    void renderImportNote();
  });
  document.getElementById("cvDiscard").addEventListener("click", () => {
    diff.innerHTML = "";
    status.textContent = "Discarded.";
    status.className = "note";
  });
});

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
}

load();
