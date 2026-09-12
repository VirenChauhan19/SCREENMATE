const FIELDS = [
  "name", "email", "location", "university", "degree",
  "minor", "graduationDate", "portfolio", "linkedin",
];

async function load() {
  const { profile = {}, backendUrl = "http://localhost:3000" } =
    await chrome.storage.local.get(["profile", "backendUrl"]);
  for (const f of FIELDS) document.getElementById(f).value = profile[f] || "";
  document.getElementById("skills").value = (profile.skills || []).join(", ");
  document.getElementById("backendUrl").value = backendUrl;
  void health(backendUrl);
}

async function health(base) {
  const el = document.getElementById("health");
  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}/api/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields: [] }),
    });
    el.textContent = res.ok ? "Backend reachable." : `Backend returned ${res.status}.`;
    el.className = `note ${res.ok ? "ok" : "bad"}`;
  } catch {
    el.textContent = "Backend unreachable. Start it with `npm run dev`.";
    el.className = "note bad";
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
  await chrome.storage.local.set({ backendUrl });
  void health(backendUrl);
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

load();
