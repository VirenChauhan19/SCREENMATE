"use client";

import { useState } from "react";
import {
  ArrowRight,
  Check,
  ListChecks,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Undo2,
} from "lucide-react";
import { CONFIDENCE_COPY } from "@/lib/policy";
import type { ApplicationState, ChangeRecord } from "@/lib/types";

interface Props {
  changes: ChangeRecord[];
  state: ApplicationState;
  busy: boolean;
  onAcceptAll: () => void;
  onAccept: (fieldId: string) => void;
  onReject: (fieldId: string) => void;
  onEdit: (fieldId: string, value: string) => void;
  onRegenerate: (fieldId: string) => void;
  onDone: () => void;
}

export function ReviewPanel({
  changes,
  state,
  busy,
  onAcceptAll,
  onAccept,
  onReject,
  onEdit,
  onRegenerate,
  onDone,
}: Props) {
  const [individual, setIndividual] = useState(false);

  if (changes.length === 0) return null;

  const reviewedCount = changes.filter(
    (c) => state.fields.find((f) => f.id === c.fieldId)?.reviewed,
  ).length;
  const allReviewed = reviewedCount === changes.length;

  return (
    <section className="fade-rise rounded-xl border border-ink-700 bg-ink-850/70 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <ListChecks size={13} strokeWidth={2.5} className="text-accent-400" />
            <span className="label-xs text-accent-300">Review changes</span>
          </div>
          <p className="text-[14px] font-medium text-mist-100">
            SCREENMATE made {changes.length} change
            {changes.length === 1 ? "" : "s"}
          </p>
          <p className="mt-1 text-[12px] text-mist-400">
            Nothing is submitted. Everything below is reversible.
          </p>
        </div>
        {!individual && !allReviewed && (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => setIndividual(true)}
              className="rounded-lg border border-ink-600 bg-ink-800 px-3.5 py-2 text-[12.5px] font-medium text-mist-300 transition-colors hover:border-ink-600 hover:text-mist-100"
            >
              Review individually
            </button>
            <button
              type="button"
              onClick={onAcceptAll}
              className="rounded-lg bg-accent-500 px-4 py-2 text-[12.5px] font-medium text-white transition-colors hover:bg-accent-400"
            >
              Accept all
            </button>
          </div>
        )}
      </div>

      <ul className="mt-5 space-y-3">
        {changes.map((change) => (
          <ChangeRow
            key={change.fieldId}
            change={change}
            reviewed={Boolean(
              state.fields.find((f) => f.id === change.fieldId)?.reviewed,
            )}
            expanded={individual}
            busy={busy}
            onAccept={() => onAccept(change.fieldId)}
            onReject={() => onReject(change.fieldId)}
            onEdit={(v) => onEdit(change.fieldId, v)}
            onRegenerate={() => onRegenerate(change.fieldId)}
          />
        ))}
      </ul>

      {(individual || allReviewed) && (
        <div className="mt-5 flex items-center justify-between border-t border-ink-700 pt-4">
          <p className="text-[11.5px] text-mist-500">
            {reviewedCount} of {changes.length} reviewed
          </p>
          <button
            type="button"
            onClick={onDone}
            className="flex items-center gap-1.5 rounded-lg bg-accent-500 px-4 py-2 text-[12.5px] font-medium text-white transition-colors hover:bg-accent-400"
          >
            Finish review
            <ArrowRight size={13} strokeWidth={2.5} />
          </button>
        </div>
      )}
    </section>
  );
}

function ChangeRow({
  change,
  reviewed,
  expanded,
  busy,
  onAccept,
  onReject,
  onEdit,
  onRegenerate,
}: {
  change: ChangeRecord;
  reviewed: boolean;
  expanded: boolean;
  busy: boolean;
  onAccept: () => void;
  onReject: () => void;
  onEdit: (value: string) => void;
  onRegenerate: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(change.after);
  const conf = CONFIDENCE_COPY[change.confidence];

  return (
    <li className="rounded-lg border border-ink-700 bg-ink-900/60 p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12.5px] font-medium text-mist-200">
            {change.label.replace(/\?$/, "")}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span
              className={`label-xs ${
                change.confidence === "high" ? "text-good-400" : "text-accent-300"
              }`}
            >
              {conf.label}
            </span>
            <span className="text-[11px] text-mist-500">{conf.note}</span>
            {change.verified && (
              <span className="label-xs flex items-center gap-1 text-good-400">
                <ShieldCheck size={10} strokeWidth={2.5} />
                Verified
              </span>
            )}
          </div>
        </div>
        {reviewed ? (
          <span className="label-xs flex shrink-0 items-center gap-1 text-good-400">
            <Check size={11} strokeWidth={3} />
            Accepted
          </span>
        ) : (
          expanded && (
            <div className="flex shrink-0 gap-1.5">
              <IconAction label="Accept" onClick={onAccept}>
                <Check size={12} strokeWidth={2.5} />
              </IconAction>
              {change.regenerable && (
                <IconAction label="Regenerate" onClick={onRegenerate} disabled={busy}>
                  <RefreshCw
                    size={12}
                    strokeWidth={2.5}
                    className={busy ? "animate-spin" : ""}
                  />
                </IconAction>
              )}
              <IconAction
                label="Edit"
                onClick={() => {
                  setDraft(change.after);
                  setEditing((v) => !v);
                }}
              >
                <Pencil size={12} strokeWidth={2.5} />
              </IconAction>
              <IconAction label="Revert" onClick={onReject}>
                <Undo2 size={12} strokeWidth={2.5} />
              </IconAction>
            </div>
          )
        )}
      </div>

      <div className="mt-3 space-y-1.5 text-[12px]">
        <div className="flex gap-2.5">
          <span className="label-xs w-12 shrink-0 pt-0.5 text-mist-500">Before</span>
          <span className="text-mist-500 line-through decoration-mist-600">
            {change.before?.trim() || "Empty"}
          </span>
        </div>
        <div className="flex gap-2.5">
          <span className="label-xs w-12 shrink-0 pt-0.5 text-mist-500">After</span>
          <span className="leading-relaxed break-words text-mist-200">
            {change.after}
          </span>
        </div>
      </div>

      {editing && (
        <div className="mt-3">
          <textarea
            rows={4}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="field-base resize-y leading-relaxed"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => {
                onEdit(draft);
                setEditing(false);
              }}
              className="rounded-md bg-accent-500 px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-accent-400"
            >
              Save edit
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-md border border-ink-600 px-3 py-1.5 text-[12px] text-mist-400 transition-colors hover:text-mist-200"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function IconAction({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="grid h-7 w-7 place-items-center rounded-md border border-ink-700 bg-ink-850 text-mist-400 transition-colors hover:border-accent-500 hover:text-accent-300 disabled:opacity-40"
    >
      {children}
    </button>
  );
}
