"use client";

import { ShieldCheck } from "lucide-react";
import type { ApplicationField } from "@/lib/types";

interface Props {
  field: ApplicationField;
  reason: string;
  remaining: number;
  onAnswer: (value: string) => void;
}

export function ApprovalCard({ field, reason, remaining, onAnswer }: Props) {
  return (
    <div className="fade-rise rounded-xl border border-warn-400/35 bg-warn-dim/45 p-5">
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck size={13} strokeWidth={2.5} className="text-warn-400" />
        <span className="label-xs text-warn-400">User decision required</span>
        {remaining > 1 && (
          <span className="label-xs text-mist-500">
            1 of {remaining}
          </span>
        )}
      </div>

      <p className="text-[15px] leading-snug font-medium text-mist-100">
        {field.label}
      </p>
      <p className="mt-2 text-[12.5px] leading-relaxed text-mist-400">
        SCREENMATE paused here. {reason}
      </p>

      <div className="mt-4 flex gap-2.5">
        {(field.options ?? ["Yes", "No"]).map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onAnswer(opt)}
            className="min-w-24 rounded-lg border border-ink-600 bg-ink-800 px-5 py-2 text-[13px] font-medium text-mist-100 transition-colors hover:border-accent-500 hover:bg-accent-dim hover:text-accent-300"
          >
            {opt}
          </button>
        ))}
      </div>

      <p className="mt-4 border-t border-warn-400/15 pt-3 text-[11px] text-mist-500">
        SCREENMATE does not make sensitive decisions without you.
      </p>
    </div>
  );
}
