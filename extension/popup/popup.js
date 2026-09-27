/**
 * The toolbar popup: is the backend reachable, is your profile ready, and a
 * button to open the panel on this page. Everything you edit lives on the
 * settings page.
 */

const $ = (id) => document.getElementById(id);

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
    resumeFile,
  } = await chrome.storage.local.get(["profile", "backendUrl", "apiKey", "resumeFile"]);

  const filled = SM_PROFILE_FIELDS.filter((f) => String(profile[f] || "").trim()).length;
  $("summary").innerHTML =
    `<div class="line">${profile.name ? `<b>${smEsc(profile.name)}</b>` : "No name yet"}${
      profile.email ? ` · ${smEsc(profile.email)}` : ""
    }</div>` +
    `<div class="line">Profile: <b>${filled}</b> of ${SM_PROFILE_FIELDS.length} filled</div>` +
    `<div class="line">Resume: ${resumeFile ? `<b>${smEsc(resumeFile.name)}</b>` : "none saved"}</div>`;

  const warn = [];
  const placeholders = SM_PROFILE_FIELDS.filter((f) => smIsPlaceholder(f, profile[f]));
  if (!profile.name && !profile.email) warn.push("Set up your profile so SCREENMATE can fill forms.");
  else if (placeholders.length) warn.push(`Your ${placeholders.join(" and ")} still hold sample values.`);
  const missing = SM_ESSENTIAL.filter((f) => !String(profile[f] || "").trim());
  if (profile.name && missing.length) warn.push(`Add your ${missing.join(", ")}.`);
  if (!resumeFile) warn.push("Save your resume to have it attached for you.");
  $("summaryWarn").textContent = warn.join(" ");

  void smHealth(backendUrl, apiKey, $("health"));
}

$("settings").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

$("open").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "screenmate:open" });
  } catch {
    // Content script not present (page loaded before install) — inject now.
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: [
          "content/scan.js",
          "content/act.js",
          "content/nav.js",
          "content/prefs.js",
          "content/panel.js",
          "content/frames.js",
          "content/main.js",
        ],
      });
      await chrome.tabs.sendMessage(tab.id, { type: "screenmate:open" });
    } catch {
      $("health").textContent = "SCREENMATE cannot run on this page.";
      $("health").className = "note bad";
      return;
    }
  }
  window.close();
});

load();
