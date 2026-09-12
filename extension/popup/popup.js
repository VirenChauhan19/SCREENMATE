const FIELDS = [
  "name", "email", "location", "university", "degree",
  "minor", "graduationDate", "portfolio", "linkedin",
];

async function load() {
  const {
    profile = {},
    backendUrl = "http://localhost:3000",
    apiKey = "",
  } = await chrome.storage.local.get(["profile", "backendUrl", "apiKey"]);
  for (const f of FIELDS) document.getElementById(f).value = profile[f] || "";
  document.getElementById("skills").value = (profile.skills || []).join(", ");
  document.getElementById("backendUrl").value = backendUrl;
  document.getElementById("apiKey").value = apiKey;
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

document.getElementById("save").addEventListener("click", async () => {
  const profile = {};
  for (const f of FIELDS) profile[f] = document.getElementById(f).value.trim();
  profile.skills = document.getElementById("skills").value
    .split(",").map((s) => s.trim()).filter(Boolean);
  await chrome.storage.local.set({ profile });
  const btn = document.getElementById("save");
  btn.textContent = "Saved";
  setTimeout(() => (btn.textContent = "Save profile"), 1200);
});

document.getElementById("saveUrl").addEventListener("click", async () => {
  const backendUrl = document.getElementById("backendUrl").value.trim();
  const apiKey = document.getElementById("apiKey").value.trim();
  await chrome.storage.local.set({ backendUrl, apiKey });

  // A custom https backend needs host permission before the worker can call it.
  try {
    const origin = new URL(backendUrl).origin + "/*";
    if (!(await chrome.permissions.contains({ origins: [origin] }))) {
      await chrome.permissions.request({ origins: [origin] });
    }
  } catch {
    /* localhost is already in host_permissions */
  }
  void health(backendUrl, apiKey);
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

const readAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(file);
  });

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

  // The message channel cannot carry a File, so it travels as a data URL.
  const dataUrl = await readAsDataUrl(file);
  const out = await new Promise((r) =>
    chrome.runtime.sendMessage(
      {
        type: "screenmate:parseCv",
        file: { name: file.name, type: file.type, dataUrl },
      },
      r,
    ),
  );

  if (!out?.ok) {
    status.textContent = `${out?.error || "Could not read that CV."}${out?.reason ? ` ${out.reason}` : ""}`;
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

  document.getElementById("cvApply").addEventListener("click", () => {
    for (const r of rows) {
      const el = document.getElementById(r.key === "skills" ? "skills" : r.key);
      if (el) el.value = r.incoming;
    }
    diff.innerHTML = "";
    status.textContent = "Applied. Review the fields below, then Save profile.";
    status.className = "note ok";
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
