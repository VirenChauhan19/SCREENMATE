const FIELDS = [
  "name", "email", "location", "university", "degree",
  "minor", "graduationDate", "portfolio", "linkedin",
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
  for (const f of FIELDS) document.getElementById(f).value = profile[f] || "";
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
    const res = await fetch(`${url}/api/health`);
    if (!res.ok) return set(`Backend returned ${res.status}.`, "bad");
    const h = await res.json();

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
  const profile = {};
  for (const f of FIELDS) profile[f] = document.getElementById(f).value.trim();
  profile.skills = document
    .getElementById("skills")
    .value.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const patch = { profile };
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
 * Deliberately fire-and-forget: this opens a Chrome dialog, and the status line
 * must never sit stale behind it waiting for an answer.
 */
async function ensureHostPermission(backendUrl) {
  try {
    const origin = new URL(backendUrl).origin + "/*";
    if (await chrome.permissions.contains({ origins: [origin] })) return;
    await chrome.permissions.request({ origins: [origin] });
  } catch {
    /* localhost is already in host_permissions, and a denial is the user's call */
  }
}

document.getElementById("saveUrl").addEventListener("click", async () => {
  const backendUrl = document.getElementById("backendUrl").value.trim();
  const apiKey = document.getElementById("apiKey").value.trim();
  await chrome.storage.local.set({ backendUrl, apiKey });

  const btn = document.getElementById("saveUrl");
  btn.textContent = "Saved";
  setTimeout(() => (btn.textContent = "Save backend settings"), 1200);

  // Re-check first, so the status always describes what was just saved.
  await health(backendUrl, apiKey);
  void ensureHostPermission(backendUrl);
});

document.getElementById("open").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "screenmate:open" });
  } catch {
    // Content script not present (page loaded before install) — inject now.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [
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
});

/* ---------------- CV import ---------------- */

const CV_KEYS = [
  ["name", "Name"], ["email", "Email"], ["location", "Location"],
  ["university", "University"], ["degree", "Degree"], ["minor", "Minor"],
  ["graduationDate", "Graduation"], ["portfolio", "Portfolio"],
  ["linkedin", "LinkedIn"], ["skills", "Skills"],
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

  let res;
  try {
    res = await fetch(`${base.replace(/\/+$/, "")}/api/parse-cv`, {
      method: "POST",
      headers,
      body: form,
    });
  } catch {
    return {
      ok: false,
      error: `Could not reach ${base}.`,
      reason: "Check the backend URL below, or that the server is running.",
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
