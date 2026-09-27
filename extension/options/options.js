/**
 * SCREENMATE settings: your resume, profile, standing answers, remembered
 * answers, and the backend. Everything is stored on this device only.
 */

const $ = (id) => document.getElementById(id);
const MAX_RESUME_BYTES = 8 * 1024 * 1024;

/* ---------------- profile ---------------- */

async function loadProfile() {
  const { profile = {} } = await chrome.storage.local.get("profile");
  for (const f of SM_PROFILE_FIELDS) $(f).value = profile[f] || "";
  $("skills").value = (profile.skills || []).join(", ");
  flagPlaceholders();
  return profile;
}

/** Sample values would be typed into real applications: point them out. */
function flagPlaceholders() {
  const bad = SM_PROFILE_FIELDS.filter((f) => smIsPlaceholder(f, $(f).value.trim()));
  for (const f of SM_PROFILE_FIELDS) $(f).classList.toggle("placeholder-warn", bad.includes(f));
  const missing = SM_ESSENTIAL.filter((f) => !$(f).value.trim());
  const notes = [];
  if (bad.length) notes.push(`${bad.join(" and ")} still hold sample values. Replace them with your own.`);
  if (missing.length) {
    notes.push(`Most applications ask for ${missing.join(", ")}; without ${missing.length === 1 ? "it" : "them"} SCREENMATE will ask you on every form.`);
  }
  $("profileWarn").textContent = notes.join(" ");
}

/** One writer for the profile, used by Save and by applying a CV import. */
async function saveProfile(extra = {}) {
  const { profile: before = {} } = await chrome.storage.local.get("profile");
  const profile = { ...before };
  for (const f of SM_PROFILE_FIELDS) profile[f] = $(f).value.trim();
  profile.skills = $("skills")
    .value.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const patch = { profile };
  if (extra.cvName) patch.cvImport = { name: extra.cvName, at: new Date().toISOString() };
  await chrome.storage.local.set(patch);
  flagPlaceholders();
}

$("save").addEventListener("click", async () => {
  const btn = $("save");
  btn.disabled = true;
  try {
    await saveProfile();
    btn.textContent = "Saved";
    setTimeout(() => (btn.textContent = "Save profile"), 1200);
  } catch { $("profileWarn").textContent = "Your profile could not be saved. Your entries are still here; try again."; }
  finally { btn.disabled = false; }
});
for (const f of SM_PROFILE_FIELDS) $(f).addEventListener("input", flagPlaceholders);

/* ---------------- resume ---------------- */

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function renderResume() {
  const { resumeFile, settings = {}, cvImport } = await chrome.storage.local.get([
    "resumeFile",
    "settings",
    "cvImport",
  ]);
  $("autoAttach").checked = settings.autoAttachResume !== false;
  $("resumeBox").hidden = !resumeFile;
  if (resumeFile) {
    $("resumeName").textContent = resumeFile.name;
    const kb = Math.max(1, Math.round((resumeFile.size || 0) / 1024));
    $("resumeMeta").textContent = `${kb} KB · saved ${new Date(resumeFile.savedAt).toLocaleDateString()}`;
  }
  const el = $("cvImported");
  if (cvImport) {
    el.textContent =
      `Profile filled from ${cvImport.name} on ${new Date(cvImport.at).toLocaleDateString()}. ` +
      "It is stored on this device, so you do not need to upload it again.";
    el.className = "note ok";
  } else {
    el.textContent = "";
  }
}

$("resumeRemove").addEventListener("click", async () => {
  await chrome.storage.local.remove("resumeFile");
  $("cvStatus").textContent = "Resume removed. Applications will ask you for a file instead.";
  $("cvStatus").className = "note";
  void renderResume();
});

$("autoAttach").addEventListener("change", async () => {
  const { settings = {} } = await chrome.storage.local.get("settings");
  await chrome.storage.local.set({
    settings: { ...settings, autoAttachResume: $("autoAttach").checked },
  });
});

/**
 * Uploads straight from this page to the backend's CV parser.
 *
 * An MV3 worker cannot fetch a data: URL, so the file never hops through it;
 * this page has the same host permissions and posts the File itself.
 */
async function uploadCv(file) {
  const { base, apiKey } = (await new Promise((r) =>
    chrome.runtime.sendMessage({ type: "screenmate:getBackend" }, r),
  )) || {};
  if (!base) return { ok: false, error: "No backend URL set. Add one below." };

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
      $("cvStatus").textContent = "Waking the server, one moment…";
      $("cvStatus").className = "note";
      await new Promise((r) => setTimeout(r, 1200));
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60_000);
      try { res = await fetch(url, { method: "POST", headers, body: form, signal: controller.signal }); }
      finally { clearTimeout(timer); }
    } catch (err) {
      lastError = err;
    }
  }
  if (!res) {
    return {
      ok: false,
      error: `Could not reach ${base}.`,
      reason: lastError ? "Check the backend below, or that the server is running." : "",
    };
  }
  const data = await res.json().catch(() => null);
  if (res.status === 401) {
    return { ok: false, error: "Backend rejected the access key.", reason: "Check the access key below." };
  }
  if (!res.ok) {
    return { ok: false, error: data?.error || `Backend returned ${res.status}.`, reason: data?.reason };
  }
  if (!data?.profile || typeof data.profile !== "object") return { ok: false, error: "The server returned an invalid profile. Try again." };
  return { ok: true, data };
}

const CV_KEYS = [
  ["name", "Name"], ["email", "Email"], ["phone", "Phone"], ["location", "Location"],
  ["country", "Country"], ["currentCompany", "Current company"], ["currentTitle", "Current title"],
  ["university", "University"], ["degree", "Degree"], ["minor", "Minor"],
  ["graduationDate", "Graduation"], ["portfolio", "Website"],
  ["linkedin", "LinkedIn"], ["github", "GitHub"], ["skills", "Skills"],
  ["experience", "Experience and projects"],
];

$("cvGo").addEventListener("click", async () => {
  const button = $("cvGo");
  if (button.disabled) return;
  button.disabled = true;
  try {
  const file = $("cvFile").files?.[0];
  const status = $("cvStatus");
  const diff = $("cvDiff");
  diff.innerHTML = "";
  if (!file) {
    status.textContent = "Choose your resume file first.";
    status.className = "note bad";
    return;
  }
  if (!/\.(pdf|docx?|txt|md|rtf|odt)$/i.test(file.name)) {
    status.textContent = "Unsupported file type. Use a PDF, DOCX or plain-text resume.";
    status.className = "note bad";
    return;
  }
  if (file.size > MAX_RESUME_BYTES) {
    status.textContent = "That resume is over 8MB. Choose a smaller file.";
    status.className = "note bad";
    return;
  }

  // Kept first, so a server that cannot read it still leaves you with a
  // resume to attach.
  let saved = false;
  if (file.size <= MAX_RESUME_BYTES) {
    await chrome.storage.local.set({
      resumeFile: {
        name: file.name,
        type: file.type || "",
        size: file.size,
        data: toBase64(await file.arrayBuffer()),
        savedAt: new Date().toISOString(),
      },
    });
    saved = true;
    void renderResume();
  }

  status.textContent = `${saved ? "Saved. " : ""}Reading ${file.name}…`;
  status.className = "note";
  if (file.size > 6 * 1024 * 1024 || !/\.(pdf|docx|txt|md)$/i.test(file.name)) {
    status.textContent = "Your resume is saved for attaching. To import profile details, use a PDF, DOCX, or text file under 6MB.";
    status.className = "note warn";
    return;
  }
  const out = await uploadCv(file);
  if (!out.ok) {
    status.textContent = `${saved ? "Your resume is saved for attaching, but it could not be read into your profile: " : ""}${out.error}${out.reason ? ` ${out.reason}` : ""}`;
    status.className = saved ? "note warn" : "note bad";
    return;
  }

  // Show what would change and let you apply or discard it. An extracted
  // profile never silently overwrites something you typed.
  const p = out.data.profile;
  const rows = [];
  for (const [key, label] of CV_KEYS) {
    const incoming = key === "skills"
      ? (p.skills || []).join(", ")
      : key === "experience"
        ? (p.experience || []).join("\n")
        : p[key];
    if (!incoming) continue;
    const current = $(key)?.value || "";
    if (current.trim() === String(incoming).trim()) continue;
    rows.push({ key, label, current, incoming: String(incoming) });
  }

  if (!rows.length) {
    status.textContent = `${saved ? "Saved. " : ""}Read ${out.data.chars} characters. Your profile already matches it.`;
    status.className = "note ok";
    return;
  }

  status.textContent = `${saved ? "Saved. " : ""}Found ${rows.length} field${rows.length === 1 ? "" : "s"} to update${
    out.data.missing?.length ? ` · not in the CV: ${out.data.missing.join(", ")}` : ""
  }`;
  status.className = "note ok";

  diff.innerHTML =
    `<div class="diff">${rows
      .map(
        (r) =>
          `<div class="drow"><span class="dk">${r.label}</span><span class="dv">` +
          (r.current ? `<span class="dold">${smEsc(r.current)}</span><br>` : "") +
          `<span class="dnew">${smEsc(r.incoming)}</span></span></div>`,
      )
      .join("")}</div>` +
    `<div class="row"><button id="cvApply">Apply ${rows.length} change${rows.length === 1 ? "" : "s"}</button>` +
    `<button class="ghost" id="cvDiscard">Discard</button></div>`;

  $("cvApply").addEventListener("click", async () => {
    const apply = $("cvApply");
    apply.disabled = true;
    try {
    for (const r of rows) $(r.key).value = r.incoming;
    // Applying saves: applying and then forgetting to press Save was the
    // easiest way to lose an import.
    await saveProfile({ cvName: file.name });
    diff.innerHTML = "";
    status.textContent = `Saved to your profile from ${file.name}. Edit anything below that is wrong.`;
    status.className = "note ok";
    void renderResume();
    } catch {
      status.textContent = "The imported profile could not be saved. Try Apply again.";
      status.className = "note bad";
    } finally { apply.disabled = false; }
  });
  $("cvDiscard").addEventListener("click", () => {
    diff.innerHTML = "";
    status.textContent = "Discarded. Your resume is still saved for attaching.";
    status.className = "note";
  });
  } catch {
    $("cvStatus").textContent = "The resume could not be saved or read. Your profile was not replaced. Try again.";
    $("cvStatus").className = "note bad";
  } finally { button.disabled = false; }
});

/* ---------------- standing answers ---------------- */

const P = window.__screenmatePrefs;

async function persistPreference(topic, value) {
  try {
    await P.setOne(topic, value);
    $("prefsStatus").textContent = "Answer saved.";
    $("prefsStatus").className = "note ok";
  } catch {
    $("prefsStatus").textContent = "Could not save that answer. Please try again.";
    $("prefsStatus").className = "note bad";
  }
}

async function renderPrefs() {
  const prefs = await P.load();
  $("prefs").innerHTML = P.QUESTIONS.map((q) => {
    const cur = prefs[q.topic] || "";
    const ask = `<button class="popt ask${cur === P.ASK ? " on" : ""}" data-topic="${q.topic}" data-val="${P.ASK}">Ask each time</button>
      <button class="popt required-only${cur === "" ? " on" : ""}" data-topic="${q.topic}" data-val="">Ask only if required</button>`;
    const body = q.free
      ? `<div class="pqo"><input class="pfree" aria-label="${smEsc(q.label)}" data-topic="${q.topic}" placeholder="${smEsc(q.placeholder || "")}"
           value="${smEsc(cur === P.ASK ? "" : cur)}" style="max-width:320px">${ask}</div>`
      : `<div class="pqo">${q.options
          .map(
            (o) =>
              `<button class="popt${cur === o ? " on" : ""}" data-topic="${q.topic}" data-val="${smEsc(o)}">${smEsc(o)}</button>`,
          )
          .join("")}${ask}</div>`;
    return `<div class="pq"><div class="pql">${smEsc(q.label)}${q.protectedTopic ? ' <span class="note">· optional to answer</span>' : ""}</div>${body}</div>`;
  }).join("");

  $("prefs").querySelectorAll(".popt").forEach((b) =>
    b.addEventListener("click", async () => {
      const row = b.closest('.pq');
      row.querySelectorAll('.popt').forEach(option => option.classList.toggle('on', option === b));
      const input = row.querySelector('.pfree');
      if (input && (b.dataset.val === P.ASK || b.dataset.val === '')) input.value = '';
      await persistPreference(b.dataset.topic, b.dataset.val);
    }),
  );
  $("prefs").querySelectorAll(".pfree").forEach((i) =>
    i.addEventListener("change", async () => {
      const v = i.value.trim();
      i.closest('.pq').querySelector('.ask')?.classList.remove('on');
      i.closest('.pq').querySelector('.required-only')?.classList.toggle('on', !v);
      await persistPreference(i.dataset.topic, v);
    }),
  );
  renderMemory(prefs);
}

/** Answers remembered from a form, keyed by the question's wording. */
function renderMemory(prefs) {
  const standing = new Set(P.QUESTIONS.map((q) => q.topic));
  const entries = Object.entries(prefs).filter(([k, v]) => !standing.has(k) && v && v !== P.ASK);
  if (!entries.length) {
    $("memory").innerHTML = `<div class="note" style="margin:0">Nothing yet. When you answer a question on a form and tick "Remember this answer", it shows up here.</div>`;
    return;
  }
  $("memory").innerHTML = entries
    .map(([k, v]) => {
      const q = k.startsWith("label:") ? k.slice(6) : k;
      return `<div class="mem"><div class="mq">${smEsc(q.charAt(0).toUpperCase() + q.slice(1))}<div class="ma">${smEsc(v)}</div></div>
        <button class="ghost small" data-forget="${smEsc(k)}">Forget</button></div>`;
    })
    .join("");
  $("memory").querySelectorAll("[data-forget]").forEach((b) =>
    b.addEventListener("click", async () => {
      const all = await P.load();
      delete all[b.dataset.forget];
      await P.save(all);
      void renderPrefs();
    }),
  );
}

/* ---------------- backend ---------------- */

async function loadBackend() {
  // Repair first: an install still pointing at a dead localhost fixes itself
  // when you look at it.
  await new Promise((r) => chrome.runtime.sendMessage({ type: "screenmate:applyConfig" }, () => r()));
  const { backendUrl = "http://localhost:3000", apiKey = "" } = await chrome.storage.local.get([
    "backendUrl",
    "apiKey",
  ]);
  $("backendUrl").value = backendUrl;
  $("apiKey").value = apiKey;
  void smHealth(backendUrl, apiKey, $("health"));
}

$("saveUrl").addEventListener("click", async () => {
  let backendUrl;
  try {
    const url = new URL($("backendUrl").value.trim());
    if (url.username || url.password || url.search || url.hash || !(url.protocol === "https:" ||
      (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) throw new Error();
    backendUrl = url.href.replace(/\/+$/, "");
  } catch {
    $("health").textContent = "Enter a valid HTTPS server URL, or http://localhost:3000 for local development.";
    $("health").className = "note bad";
    return;
  }
  const permitted = smEnsureHostPermission(backendUrl);
  const apiKey = $("apiKey").value.trim();
  if (!(await permitted)) {
    $("health").textContent = "Server access was not granted. Your previous settings were kept.";
    $("health").className = "note bad";
    return;
  }
  try { await chrome.storage.local.set({ backendUrl, apiKey, backendConfigured: true }); }
  catch {
    $("health").textContent = "Backend settings could not be saved. Try again.";
    $("health").className = "note bad";
    return;
  }
  const btn = $("saveUrl");
  btn.textContent = "Saved";
  setTimeout(() => (btn.textContent = "Save backend settings"), 1200);
  // Re-check first, so the status always describes what was just saved.
  await smHealth(backendUrl, apiKey, $("health"));
});

/* ---------------- boot ---------------- */

(async () => {
  $("version").textContent = `v${chrome.runtime.getManifest().version}`;
  await loadBackend();
  const profile = await loadProfile();
  await renderResume();
  await renderPrefs();
  const empty = !profile.name && !profile.email;
  if (location.hash === "#welcome" || empty) $("welcome").hidden = false;
})();
