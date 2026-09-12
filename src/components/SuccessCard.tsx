"use client";

import { Check, CircleCheck, TriangleAlert, X } from "lucide-react";
import type { ApplicationState, RunStats, ValidationReport } from "@/lib/types";

interface Props {
  state: ApplicationState;
  report: ValidationReport;
  stats: RunStats;
  onReview: () => void;
}

export function SuccessCard({ state, report, stats, onReview }: Props) {
  const required = state.fields.filter((f) => f.required);
  const requiredDone = required.filter(
    (f) => f.value && f.value.trim().length > 0,
  ).length;
  const clean = report.blockers.length === 0;

  const lines: { n: number; label: string }[] = [
    { n: stats.safeFields, label: "safe fields completed" },
    { n: stats.researchedResponses, label: "researched response" },
    { n: stats.reviewedSuggestions, label: "reviewed suggestions" },
    { n: stats.userDecisions, label: "user decisions" },
    { n: stats.verifiedActions, label: "actions verified" },
  ].filter((l) => l.n > 0);

  return (
    <section className="fade-rise rounded-xl border border-good-400/25 bg-good-dim/35 p-6">
      <div className="flex items-start gap-3">
        <CircleCheck
          size={18}
          strokeWidth={2}
          className="mt-0.5 shrink-0 text-good-400"
        />
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] leading-tight font-semibold tracking-[-0.01em] text-mist-100">
            Application ready
          </h2>
          <p className="mt-1.5 text-[13px] text-mist-300">
            {requiredDone} / {required.length} required fields complete
          </p>

          <div className="mt-5 grid gap-6 sm:grid-cols-2">
            <div>
              <p className="label-xs mb-2.5 text-mist-500">SCREENMATE completed</p>
              <ul className="space-y-1.5">
                {lines.map((l) => (
                  <li key={l.label} className="text-[12.5px] text-mist-300">
                    <span className="font-medium text-mist-100">{l.n}</span>{" "}
                    {l.label}
                  </li>
                ))}
                {stats.sourcesUsed > 0 && (
                  <li className="text-[12.5px] text-mist-300">
                    <span className="font-medium text-mist-100">
                      {stats.sourcesUsed}
                    </span>{" "}
                    external sources used
                  </li>
                )}
              </ul>
            </div>

            <div>
              <p className="label-xs mb-2.5 text-mist-500">Validation</p>
              <ul className="space-y-1.5">
                {report.checks.map((c) => (
                  <li key={c.id} className="flex items-start gap-1.5 text-[12px]">
                    {c.ok ? (
                      <Check
                        size={12}
                        strokeWidth={3}
                        className="mt-0.5 shrink-0 text-good-400"
                      />
                    ) : (
                      <X
                        size={12}
                        strokeWidth={3}
                        className="mt-0.5 shrink-0 text-warn-400"
                      />
                    )}
                    <span className={c.ok ? "text-mist-400" : "text-warn-400"}>
                      {c.label}
                      {c.detail && (
                        <span className="text-mist-500"> · {c.detail}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              <p
                className={`mt-3 text-[12px] font-medium ${
                  clean ? "text-good-400" : "text-warn-400"
                }`}
              >
                {report.blockers.length} blocker
                {report.blockers.length === 1 ? "" : "s"}
              </p>
            </div>
          </div>

          {report.blockers.length > 0 && (
            <ul className="mt-4 space-y-1.5 rounded-lg border border-warn-400/25 bg-warn-dim/40 p-3">
              {report.blockers.map((b) => (
                <li
                  key={`${b.fieldId}-${b.message}`}
                  className="flex items-start gap-1.5 text-[12px] text-warn-400"
                >
                  <TriangleAlert size={11} strokeWidth={2} className="mt-0.5" />
                  {b.message}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-good-400/15 pt-4">
            <button
              type="button"
              onClick={onReview}
              className="rounded-lg border border-ink-600 bg-ink-800 px-4 py-2 text-[13px] font-medium text-mist-100 transition-colors hover:border-accent-500 hover:text-accent-300"
            >
              Review application
            </button>
            <p className="text-[11.5px] text-mist-400">
              SCREENMATE completed what it could safely automate and left final
              control with you.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
