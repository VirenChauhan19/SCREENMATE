"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowUpRight, Check, Download, FileText, LockKeyhole, Plug, RefreshCw, Save, ShieldCheck, Upload, UserRound } from "lucide-react";
import { EMPTY_PROFILE, PROFILE_FIELDS, PROFILE_CONTEXT_FIELDS, PROFILE_CONTEXT_LIMIT, isProfileContextKey, parseApplicant, type ApplicantProfile } from "@/lib/applicant";

const STORAGE_KEY = "screenmate.applicant.v1";
type Health = { service: string; requiresKey: boolean; configured: { openrouter: boolean; exa: boolean } };

function extensionMessage(action: "ping" | "saveProfile", profile?: ApplicantProfile): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", receive);
      reject(new Error("Install or reload the extension, set its Server URL to this website, then refresh this page."));
    }, 4000);
    function receive(event: MessageEvent) {
      if (event.source !== window || event.origin !== location.origin || event.data?.source !== "screenmate:extension" || event.data?.id !== id) return;
      clearTimeout(timer);
      window.removeEventListener("message", receive);
      if (event.data.ok) resolve();
      else reject(new Error(event.data.error || "The extension could not save your profile."));
    }
    window.addEventListener("message", receive);
    window.postMessage({ source: "screenmate:website", action, id, profile }, location.origin);
  });
}

export function Workspace() {
  const [profile, setProfile] = useState<ApplicantProfile>({ ...EMPTY_PROFILE });
  const [skills, setSkills] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [health, setHealth] = useState<Health | null>(null);
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [accessKey, setAccessKey] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [extension, setExtension] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [imported, setImported] = useState<ApplicantProfile | null>(null);
  const [jobUrl, setJobUrl] = useState("");
  const [origin, setOrigin] = useState("");

  async function checkHealth() {
    setChecking(true);
    try {
      const [server, session] = await Promise.all([
        fetch("/api/health", { cache: "no-store", signal: AbortSignal.timeout(10000) }),
        fetch("/api/session", { cache: "no-store", signal: AbortSignal.timeout(10000) }),
      ]);
      if (!server.ok || !session.ok) throw new Error();
      const data = await server.json();
      if (data.service !== "screenmate" || !data.configured) throw new Error();
      setHealth(data);
      setAuthenticated(Boolean((await session.json()).authenticated));
    } catch {
      setHealth(null);
      setAuthenticated(false);
    } finally { setChecking(false); }
  }

  useEffect(() => {
    setOrigin(location.origin);
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const restored = parseApplicant(JSON.parse(raw));
        setProfile(restored); setSkills(restored.skills.join(", ")); setSaved(true);
      }
    } catch { setError("Your saved profile could not be read. You can enter your details below."); }
    setLoaded(true);
    void checkHealth();
    void extensionMessage("ping").then(() => setExtension(true)).catch(() => {});
  }, []);

  function currentProfile() {
    return parseApplicant({ ...profile, skills: skills.split(",").map((skill) => skill.trim()).filter(Boolean) });
  }

  function saveProfile(event: FormEvent) {
    event.preventDefault(); setError(""); setNotice("");
    try {
      const next = currentProfile();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setProfile(next); setSaved(true); setNotice("Profile saved on this browser. Send it to the extension when you are ready.");
    } catch { setError("Could not save your profile. Check the field lengths and allow browser storage, or download a profile copy."); }
  }

  async function unlock(event: FormEvent) {
    event.preventDefault(); setUnlocking(true); setError("");
    try {
      const response = await fetch("/api/session", { method: "POST", headers: { "x-screenmate-key": accessKey }, signal: AbortSignal.timeout(10000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setAuthenticated(true); setAccessKey(""); setNotice("Website unlocked for this browser session.");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not connect. Please try again."); }
    finally { setUnlocking(false); }
  }

  async function readCv() {
    if (!file) return;
    setError(""); setNotice(""); setImported(null);
    if (file.size > 6 * 1024 * 1024) { setError("Choose a CV smaller than 6 MB."); return; }
    setUploading(true);
    try {
      const body = new FormData(); body.append("cv", file);
      const response = await fetch("/api/parse-cv", { method: "POST", body, signal: AbortSignal.timeout(75000) });
      const data = await response.json();
      if (response.status === 401) setAuthenticated(false);
      if (!response.ok) throw new Error([data.error, data.reason].filter(Boolean).join(" "));
      setImported(parseApplicant(data.profile));
    } catch (err) { setError(err instanceof Error ? err.message : "Could not read that CV."); }
    finally { setUploading(false); }
  }

  function applyImport() {
    if (!imported) return;
    setProfile((previous) => Object.fromEntries(Object.entries(previous).map(([key, value]) => [key, imported[key as keyof ApplicantProfile]?.length ? imported[key as keyof ApplicantProfile] : value])) as ApplicantProfile);
    if (imported.skills.length) setSkills(imported.skills.join(", "));
    setImported(null); setSaved(false); setNotice("CV details added to the form. Review and save your profile below.");
  }

  function exportProfile() {
    try {
      const data = currentProfile();
      const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, profile: data }, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = "screenmate-profile.json"; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError("Check your profile before downloading it. Use at most 60 skills."); }
  }

  async function sendProfile() {
    setSending(true); setError(""); setNotice("");
    try {
      const data = currentProfile();
      if (!data.name.trim() || !data.email.trim()) throw new Error("Add your full name and email before connecting your profile.");
      await extensionMessage("saveProfile", data); setExtension(true);
      setNotice("Profile saved in the extension. Open a job application, then choose Run SCREENMATE in its panel.");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not connect to the extension."); }
    finally { setSending(false); }
  }

  function openJob(event: FormEvent) {
    event.preventDefault(); setError("");
    try {
      const url = new URL(jobUrl);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
      window.open(url.href, "_blank", "noopener,noreferrer");
    } catch { setError("Enter a complete job application URL starting with https://."); }
  }

  const connectionLabel = checking ? "Checking connection" : !health ? "Server unavailable" : !health.configured.openrouter ? "AI setup needed" : !authenticated ? "Access key needed" : "Ready to connect";
  const ready = Boolean(health?.configured.openrouter && authenticated);

  return (
    <div className="workspace" data-screenmate-workspace>
      <header className="workspace-header">
        <Link href="/" className="workspace-brand"><span className="workspace-mark">S</span> SCREENMATE</Link>
        <nav aria-label="Main navigation"><span className="workspace-current">Workspace</span><Link href="/demo">Try the demo <ArrowUpRight size={16} /></Link></nav>
      </header>
      <main className="workspace-main">
        <div className="workspace-heading"><div><p className="workspace-eyebrow">YOUR NEXT APPLICATION</p><h1>Ready when you are.</h1><p>Your details, connected to the job application in front of you.</p></div><span className={`workspace-status ${ready ? "is-ready" : ""}`}><span />{connectionLabel}</span></div>
        <div aria-live="polite" className="workspace-messages">{error && <p role="alert" className="workspace-error">{error}</p>}{notice && <p className="workspace-notice">{notice}</p>}</div>
        <div className="workspace-grid">
          <section className="workspace-card profile-card" aria-labelledby="profile-title">
            <div className="workspace-card-heading"><div className="workspace-icon"><UserRound size={20} /></div><div><h2 id="profile-title">Your application profile</h2><p>Fill it once. Review it before every application.</p></div><span className="workspace-tag">{saved ? "Saved on this device" : "Unsaved"}</span></div>
            <div className="workspace-import"><div><FileText size={19} /><div><h3>Start with your CV</h3><p>PDF, DOCX or text · Up to 6 MB</p></div></div><label className="workspace-file-label">Choose CV<input type="file" accept=".pdf,.docx,.txt,.md" disabled={uploading} onChange={(event) => { setFile(event.target.files?.[0] || null); setImported(null); }} /></label>{file && <span className="workspace-filename">{file.name}</span>}<button type="button" className="workspace-secondary" disabled={!file || !ready || uploading} onClick={readCv}><Upload size={16} />{uploading ? "Reading CV…" : "Read CV"}</button><p className="workspace-help">Reading a CV sends it to this server and its AI provider to extract your details. Review the result before saving.</p></div>
            {imported && <div className="workspace-import-review"><h3>Review the extracted details</h3><dl>{PROFILE_FIELDS.filter(([key]) => imported[key]).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{imported[key]}</dd></div>)}{imported.skills.length > 0 && <div><dt>Skills</dt><dd>{imported.skills.join(", ")}</dd></div>}</dl><div className="workspace-actions"><button className="workspace-primary" onClick={applyImport}>Use these details</button><button className="workspace-secondary" onClick={() => setImported(null)}>Discard</button></div></div>}
            <form onSubmit={saveProfile}>
              <fieldset disabled={!loaded} className="workspace-fields">
                {PROFILE_FIELDS.filter(([key]) => !isProfileContextKey(key)).map(([key, label]) => <label key={key} className={key === "name" ? "workspace-wide" : ""} htmlFor={`profile-${key}`}><span>{label}{["name", "email"].includes(key) && <span className="workspace-required"> *</span>}</span><input id={`profile-${key}`} name={key} value={profile[key]} required={["name", "email"].includes(key)} maxLength={500} type={key === "email" ? "email" : key === "phone" ? "tel" : ["portfolio", "linkedin", "github"].includes(key) ? "url" : "text"} autoComplete={key === "name" ? "name" : key === "firstName" ? "given-name" : key === "lastName" ? "family-name" : key === "email" ? "email" : key === "phone" ? "tel" : "off"} onChange={(event) => { setProfile((previous) => ({ ...previous, [key]: event.target.value })); setSaved(false); }} /></label>)}
                <label className="workspace-wide" htmlFor="profile-skills"><span>Skills</span><textarea id="profile-skills" value={skills} maxLength={6000} rows={3} placeholder="Separate skills with commas" onChange={(event) => { setSkills(event.target.value); setSaved(false); }} /></label>
                <p className="workspace-help workspace-wide">Add your real responsibilities, projects and results below. SCREENMATE uses these details to personalize written application answers. Include only facts you can stand behind.</p>
                {PROFILE_CONTEXT_FIELDS.map(([key, label]) => <label key={key} className="workspace-wide" htmlFor={`profile-${key}`}><span>{label}</span><textarea id={`profile-${key}`} name={key} value={profile[key]} maxLength={PROFILE_CONTEXT_LIMIT} rows={key === "professionalSummary" ? 3 : 5} placeholder={key === "professionalSummary" ? "Your background, strengths and professional focus" : key === "experience" ? "Roles, employers, responsibilities and outcomes. Include dates and numbers only when accurate." : "Projects you worked on, your contribution, the tools used and what happened."} onChange={(event) => { setProfile((previous) => ({ ...previous, [key]: event.target.value })); setSaved(false); }} /></label>)}
              </fieldset>
              <div className="workspace-save-row"><p><ShieldCheck size={16} /> Saved in this browser. Sent to the extension only when you choose.</p><button className="workspace-primary" type="submit" disabled={!loaded}><Save size={16} />Save profile</button></div>
            </form>
          </section>
          <aside className="workspace-sidebar">
            <section className="workspace-card"><div className="workspace-card-heading"><div className="workspace-icon"><Plug size={20} /></div><div><h2>Connect to real job sites</h2><p>The extension works inside the employer’s form.</p></div></div>
              <ol className="workspace-steps"><li><span>1</span><div><h3>Install the Chrome extension</h3><p>Download and extract the ZIP. Open <code>chrome://extensions</code>, enable Developer mode, then choose <strong>Load unpacked</strong> and the extracted folder.</p><a href="/api/extension" className="workspace-primary" download><Download size={16} />Download extension</a></div></li><li><span>2</span><div><h3>Connect your profile</h3><p>In the extension popup, save your access key under Backend. Its Server URL should be:</p><code className="workspace-server">{origin || "This website’s address"}</code><p>Refresh this page after installing, then send your reviewed profile.</p><button className="workspace-secondary" type="button" onClick={sendProfile} disabled={!loaded || sending}><Plug size={16} />{sending ? "Connecting…" : "Send profile to extension"}</button><p className="workspace-help">{extension ? "Extension detected on this website." : "Extension not connected yet."}</p></div></li><li><span>3</span><div><h3>Open an application</h3><p>Go to the employer’s application form. Open SCREENMATE from Chrome’s toolbar and choose <strong>Run SCREENMATE</strong>.</p></div></li></ol>
              <div className="workspace-transfer"><button onClick={exportProfile} type="button"><Download size={15} />Download a profile copy</button><p>Import it in the extension popup if direct connection is unavailable.</p></div>
            </section>
            <section className="workspace-card"><div className="workspace-card-heading"><div><h2>Open your next application</h2><p>Paste the employer’s application link.</p></div></div><form onSubmit={openJob} className="workspace-job"><label htmlFor="job-url" className="sr-only">Job application URL</label><input id="job-url" type="url" required value={jobUrl} onChange={(event) => setJobUrl(event.target.value)} placeholder="https://company.com/careers/…" /><button className="workspace-primary" type="submit">Open job site <ArrowUpRight size={16} /></button></form><p className="workspace-help">Sign-in, document uploads, and final submission stay with you. Site compatibility depends on the form’s controls.</p></section>
            <section className="workspace-card"><div className="workspace-card-heading"><div className="workspace-icon"><LockKeyhole size={19} /></div><div><h2>Connection</h2><p>{connectionLabel}</p></div><button type="button" className="workspace-icon-button" aria-label="Refresh connection status" disabled={checking} onClick={checkHealth}><RefreshCw size={17} /></button></div>
              {!authenticated && <form onSubmit={unlock} className="workspace-unlock"><label htmlFor="access-key">SCREENMATE access key</label><input id="access-key" type="password" value={accessKey} required autoComplete="current-password" onChange={(event) => setAccessKey(event.target.value)} placeholder="Enter your access key" /><button className="workspace-secondary" disabled={unlocking} type="submit">{unlocking ? "Connecting…" : "Unlock website"}</button><p className="workspace-help">Use the access key from whoever hosts this SCREENMATE server. This is separate from the AI provider’s key.</p></form>}
              {authenticated && <p className="workspace-connection-ok"><Check size={17} />Website access unlocked</p>}
              {health && !health.configured.openrouter && <p className="workspace-error">The server needs its AI provider key before CV import and AI assistance can run.</p>}
              {health && !health.configured.exa && <p className="workspace-help">Company research is unavailable. Other features can still run.</p>}
              {authenticated && <button className="workspace-text-button" type="button" onClick={async () => { try { const response = await fetch("/api/session", { method: "DELETE" }); if (!response.ok) throw new Error(); setAuthenticated(false); } catch { setError("Could not lock this session. Try again."); } }}>Lock this session</button>}
            </section>
          </aside>
        </div>
        <footer className="workspace-footer"><span>SCREENMATE</span><p>Your details. Your decisions. You press submit.</p><Link href="/demo">Explore the sample application <ArrowUpRight size={14} /></Link></footer>
      </main>
    </div>
  );
}
