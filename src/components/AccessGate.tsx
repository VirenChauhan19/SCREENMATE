"use client";

import { useEffect, useState, type ReactNode, type FormEvent } from "react";

export function AccessGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    void fetch("/api/session", { cache: "no-store", signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(); return response.json(); })
      .then(data => setReady(data.authenticated === true))
      .catch(() => setError("Could not check your connection. Try signing in again."))
      .finally(() => { clearTimeout(timer); setChecking(false); });
    return () => { clearTimeout(timer); controller.abort(); };
  }, []);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    if (busy || !key.trim()) return;
    setBusy(true); setError("");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch("/api/session", { method: "POST",
        headers: { "x-screenmate-key": key.trim() }, signal: controller.signal });
      if (!response.ok) {
        setError(response.status === 401 ? "That access key was not accepted. Check it and try again." :
          "Sign-in is unavailable. Check the server configuration and try again.");
        return;
      }
      setKey(""); setReady(true);
    } catch { setError("Could not reach SCREENMATE. Check your connection and try again."); }
    finally { clearTimeout(timer); setBusy(false); }
  }

  if (ready) return <>{children}</>;
  return <main className="flex min-h-dvh items-center justify-center bg-slate-50 p-6">
    <form onSubmit={signIn} className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold">Connect to SCREENMATE</h1>
      <p className="text-sm text-slate-600">Enter the access key provided by your backend owner. Your session lasts eight hours.</p>
      <label className="block text-sm font-medium" htmlFor="access-key">Access key</label>
      <input id="access-key" type="password" autoComplete="off" required value={key}
        onChange={event => setKey(event.target.value)} className="w-full rounded-lg border border-slate-300 p-3" />
      <p role="status" className="text-sm text-red-700">{checking ? "Checking connection…" : error}</p>
      <button type="submit" disabled={checking || busy || !key.trim()}
        className="w-full rounded-lg bg-slate-900 p-3 text-white disabled:opacity-50">{busy ? "Connecting…" : "Connect"}</button>
    </form>
  </main>;
}
