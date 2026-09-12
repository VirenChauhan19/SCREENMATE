"use client";

import { ChevronDown, Play, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ROLES } from "@/lib/application";

interface Props {
  roleId: string;
  jobTitle: string;
  company: string;
  online: boolean;
  onReset: () => void;
  onStartDemo: () => void;
  onChangeRole: (roleId: string) => void;
}

export function TopBar({
  roleId,
  jobTitle,
  company,
  online,
  onReset,
  onStartDemo,
  onChangeRole,
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-ink-800 bg-ink-900/80 px-6 backdrop-blur">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2.5">
          <div className="grid h-6 w-6 place-items-center rounded-md bg-accent-500 text-[11px] font-bold text-white">
            S
          </div>
          <span className="text-[13px] font-semibold tracking-[0.18em] text-mist-100">
            SCREENMATE
          </span>
        </div>
        <span className="flex items-center gap-1.5 rounded-full border border-ink-700 bg-ink-850 px-2.5 py-1">
          <span
            className={`h-1.5 w-1.5 rounded-full ${online ? "bg-good-400" : "bg-mist-500"}`}
          />
          <span className="label-xs text-mist-400">
            {online ? "Agent online" : "Agent offline"}
          </span>
        </span>
      </div>

      <div className="flex items-center gap-2.5">
        {/* Role switcher — changing it invalidates gathered research. */}
        <div className="relative hidden sm:block" ref={wrapRef}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-850 py-1.5 pr-2.5 pl-3 text-left transition-colors hover:border-ink-600"
          >
            <span>
              <span className="block text-[12px] leading-tight font-medium text-mist-200">
                {jobTitle}
              </span>
              <span className="block text-[10.5px] text-mist-500">{company}</span>
            </span>
            <ChevronDown
              size={13}
              strokeWidth={2}
              className={`text-mist-500 transition-transform duration-200 ${
                open ? "rotate-180" : ""
              }`}
            />
          </button>

          {open && (
            <div className="fade-rise absolute right-0 z-20 mt-2 w-64 overflow-hidden rounded-lg border border-ink-700 bg-ink-850 shadow-xl shadow-black/40">
              <p className="label-xs border-b border-ink-800 px-3 py-2.5 text-mist-500">
                Switch opening
              </p>
              {ROLES.map((role) => (
                <button
                  key={role.id}
                  type="button"
                  onClick={() => {
                    onChangeRole(role.id);
                    setOpen(false);
                  }}
                  className={`block w-full px-3 py-2.5 text-left transition-colors hover:bg-ink-800 ${
                    role.id === roleId ? "bg-ink-800" : ""
                  }`}
                >
                  <span
                    className={`block text-[12.5px] font-medium ${
                      role.id === roleId ? "text-accent-300" : "text-mist-200"
                    }`}
                  >
                    {role.jobTitle}
                  </span>
                  <span className="block text-[11px] text-mist-500">
                    {role.company}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onStartDemo}
          className="flex items-center gap-1.5 rounded-lg border border-accent-500/40 bg-accent-dim px-3 py-1.5 text-[12px] font-medium text-accent-300 transition-colors hover:border-accent-500 hover:bg-accent-dim/80"
        >
          <Play size={11} strokeWidth={2.5} fill="currentColor" />
          Start demo
        </button>

        <button
          type="button"
          onClick={onReset}
          className="flex items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-850 px-3 py-1.5 text-[12px] text-mist-300 transition-colors hover:border-ink-600 hover:text-mist-100"
        >
          <RotateCcw size={12} strokeWidth={2} />
          Reset
        </button>
      </div>
    </header>
  );
}
