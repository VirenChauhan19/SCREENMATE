"use client";

import { Building2, Clock3, MapPin } from "lucide-react";
import { SECTIONS } from "@/lib/application";
import type {
  ApplicationState,
  ChangeRecord,
  RunStats,
  ValidationReport,
} from "@/lib/types";
import { FormField } from "./FormField";
import { ApprovalCard } from "./ApprovalCard";
import { ReviewPanel } from "./ReviewPanel";
import { SuccessCard } from "./SuccessCard";
import type { ApprovalRequest } from "@/hooks/useScreenmate";

interface Props {
  state: ApplicationState;
  approval: ApprovalRequest | null;
  approvalCount: number;
  changes: ChangeRecord[];
  report: ValidationReport | null;
  stats: RunStats;
  showReview: boolean;
  showSuccess: boolean;
  busy: boolean;
  lastWrite: { fieldId: string; at: number } | null;
  onChange: (fieldId: string, value: string) => void;
  onApprovalAnswer: (fieldId: string, value: string) => void;
  onAcceptAll: () => void;
  onAccept: (fieldId: string) => void;
  onReject: (fieldId: string) => void;
  onEdit: (fieldId: string, value: string) => void;
  onRegenerate: (fieldId: string) => void;
  onFinishReview: () => void;
}

export function ApplicationForm({
  state,
  approval,
  approvalCount,
  changes,
  report,
  stats,
  showReview,
  showSuccess,
  busy,
  lastWrite,
  onChange,
  onApprovalAnswer,
  onAcceptAll,
  onAccept,
  onReject,
  onEdit,
  onRegenerate,
  onFinishReview,
}: Props) {
  const errorsFor = (id: string) =>
    state.validationErrors.filter((e) => e.fieldId === id);

  const approvalField = approval
    ? state.fields.find((f) => f.id === approval.fieldId)
    : undefined;

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <header className="border-b border-ink-800 pb-8">
        <div className="label-xs mb-3 text-accent-400">
          {state.company} · Careers
        </div>
        <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em] text-mist-100">
          {state.jobTitle}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px] text-mist-400">
          <span className="flex items-center gap-1.5">
            <Building2 size={13} strokeWidth={1.8} />
            {state.company}
          </span>
          <span className="flex items-center gap-1.5">
            <MapPin size={13} strokeWidth={1.8} />
            Atlanta, GA · Hybrid
          </span>
          <span className="flex items-center gap-1.5">
            <Clock3 size={13} strokeWidth={1.8} />
            Summer 2026 Internship
          </span>
        </div>
        <p className="mt-5 max-w-2xl text-[13px] leading-relaxed text-mist-400">
          {state.jobDescription}
        </p>
      </header>

      {/* Interrupts sit above the form, in reading order, not in a modal. */}
      <div className="mt-8 space-y-4 empty:mt-0">
        {approvalField && approval && (
          <ApprovalCard
            field={approvalField}
            reason={approval.reason}
            remaining={approvalCount}
            onAnswer={(value) => onApprovalAnswer(approvalField.id, value)}
          />
        )}

        {showSuccess && report && (
          <SuccessCard
            state={state}
            report={report}
            stats={stats}
            onReview={onFinishReview}
          />
        )}

        {showReview && (
          <ReviewPanel
            changes={changes}
            state={state}
            busy={busy}
            onAcceptAll={onAcceptAll}
            onAccept={onAccept}
            onReject={onReject}
            onEdit={onEdit}
            onRegenerate={onRegenerate}
            onDone={onFinishReview}
          />
        )}
      </div>

      <div className="mt-2">
        {SECTIONS.map((section) => {
          const fields = state.fields.filter((f) => f.section === section.id);
          if (fields.length === 0) return null;
          return (
            <section
              key={section.id}
              className="border-b border-ink-800 py-8 last:border-b-0"
            >
              <div className="mb-5">
                <h2 className="label-xs text-mist-300">{section.label}</h2>
                <p className="mt-1.5 text-[12px] text-mist-500">{section.hint}</p>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                {fields.map((field) => (
                  <FormField
                    key={field.id}
                    field={field}
                    errors={errorsFor(field.id)}
                    highlight={lastWrite?.fieldId === field.id}
                    onChange={(value) => onChange(field.id, value)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <footer className="flex items-center justify-between border-t border-ink-800 pt-6 pb-4">
        <p className="text-[11.5px] text-mist-500">
          {state.completedFields} of {state.totalFields} fields complete
          {state.validationErrors.length > 0 &&
            ` · ${state.validationErrors.length} need attention`}
        </p>
        <button
          type="button"
          disabled
          title="Submission is intentionally out of scope — SCREENMATE never submits for you."
          className="cursor-not-allowed rounded-lg border border-ink-700 bg-ink-850 px-5 py-2 text-[13px] font-medium text-mist-500"
        >
          Submit application
        </button>
      </footer>
    </div>
  );
}
