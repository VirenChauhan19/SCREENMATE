"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Circle,
  Eye,
  ExternalLink,
  Lock,
  Minus,
  PenLine,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Zap,
} from "lucide-react";
import type {
  ActivityEntry,
  ActivityKind,
  AgentStatus,
  ApplicationState,
  PlanStep,
  ResearchContext,
} from "@/lib/types";
import type { ContextAlert } from "@/hooks/useScreenmate";

interface Props {
  state: ApplicationState;
  status: AgentStatus;
  goal: string | null;
  steps: PlanStep[];
  activity: ActivityEntry[];
  research: ResearchContext | null;
  contextAlert: ContextAlert | null;
  banner: string | null;
  isRunning: boolean;
  onRun: () => void;
  onStartDemo: () => void;
  onRestore: () => void;
  onDismissAlert: () => void;
}

const STATUS_COPY: Record<AgentStatus, string> = {
  idle: "Standing by",
  observing: "Observing",
  researching: "Researching",
  planning: "Planning",
  acting: "Acting",
  verifying: "Verifying",
  waiting: "Waiting for user",
  reviewing: "Awaiting your review",
  complete: "Complete",
  error: "Agent unavailable",
};

const STATUS_TONE: Record<AgentStatus, string> = {
  idle: "text-mist-400",
  observing: "text-accent-300",
  researching: "text-accent-300",
  planning: "text-accent-300",
  acting: "text-accent-300",
  verifying: "text-accent-300",
  waiting: "text-warn-400",
  reviewing: "text-warn-400",
  complete: "text-good-400",
  error: "text-bad-400",
};

const ICONS: Record<ActivityKind, typeof Eye> = {
  observe: Eye,
  research: Search,
  success: Check,
  think: Sparkles,
  action: Zap,
  write: PenLine,
  lock: Lock,
  warn: TriangleAlert,
  verify: ShieldCheck,
  context: RefreshCw,
};

const ICON_TONE: Record<ActivityKind, string> = {
  observe: "text-mist-400",
  research: "text-accent-300",
  success: "text-good-400",
  think: "text-accent-300",
  action: "text-accent-300",
  write: "text-accent-300",
  lock: "text-warn-400",
  warn: "text-warn-400",
  verify: "text-good-400",
  context: "text-warn-400",
};

export function AgentPanel({
  state,
  status,
  goal,
  steps,
  activity,
  research,
  contextAlert,
  banner,
  isRunning,
  onRun,
  onStartDemo,
  onRestore,
  onDismissAlert,
}: Props) {
  const feedRef = useRef<HTMLDivElement>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  useEffect(() => {
    feedRef.current?.scrollTo({
      top: feedRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [activity.length]);

  const progress =
    state.totalFields === 0
      ? 0
      : Math.round((state.completedFields / state.totalFields) * 100);

  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-ink-800 bg-ink-900">
      {/* Identity */}
      <div className="shrink-0 border-b border-ink-800 px-6 py-5">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-[13px] font-semibold tracking-[0.16em] text-mist-100">
              SCREENMATE
            </h2>
            <p className="label-xs mt-1.5 text-mist-500">AI workflow agent</p>
          </div>
          <span className="flex items-center gap-1.5 rounded-full border border-good-400/25 bg-good-dim px-2.5 py-1">
            <span
              className={`h-1.5 w-1.5 rounded-full bg-good-400 ${isRunning ? "pulse-dot" : ""}`}
            />
            <span className="label-xs text-good-400">Active</span>
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" ref={feedRef}>
        {/* Context */}
        <Section title="Current context">
          <p className="text-[13.5px] font-medium text-mist-100">{state.jobTitle}</p>
          <p className="text-[12.5px] text-mist-400">{state.company}</p>

          <div className="mt-4">
            <div className="mb-1.5 flex justify-between text-[11px] text-mist-500">
              <span>
                {state.completedFields}/{state.totalFields} fields
              </span>
              <span>{progress}%</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-ink-800">
              <div
                className="h-full rounded-full bg-accent-500 transition-[width] duration-700 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </Section>

        {/* Goal */}
        {goal && (
          <Section title="Current goal">
            <p className="text-[12.5px] leading-relaxed text-mist-200">{goal}</p>
          </Section>
        )}

        {/* Plan */}
        {steps.length > 0 && (
          <Section title="Agent plan">
            <ol className="space-y-2">
              {steps.map((step, i) => (
                <li
                  key={`${step.kind}-${i}`}
                  className="flex items-start gap-2 text-[12.5px]"
                >
                  <StepMark status={step.status} />
                  <span
                    className={
                      step.status === "done"
                        ? "text-mist-400"
                        : step.status === "active"
                          ? "font-medium text-accent-300"
                          : step.status === "skipped"
                            ? "text-mist-600 line-through"
                            : "text-mist-500"
                    }
                  >
                    {step.label}
                  </span>
                </li>
              ))}
            </ol>
          </Section>
        )}

        {/* Status */}
        <Section title="Live status">
          <div className="flex items-center gap-2">
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                isRunning ? "bg-accent-400 pulse-dot" : "bg-mist-600"
              }`}
            />
            <p className={`text-[13.5px] font-medium ${STATUS_TONE[status]}`}>
              {STATUS_COPY[status]}
            </p>
          </div>

          {banner && (
            <p className="mt-3 rounded-lg border border-warn-400/25 bg-warn-dim/50 px-3 py-2 text-[11.5px] leading-relaxed text-warn-400">
              {banner}
            </p>
          )}

          {status === "idle" && (
            <div className="mt-4 space-y-2">
              <button
                type="button"
                onClick={onRun}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent-500 px-4 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-400"
              >
                <Play size={13} strokeWidth={2.5} fill="currentColor" />
                Run SCREENMATE
              </button>
              <button
                type="button"
                onClick={onStartDemo}
                className="w-full rounded-lg border border-ink-700 bg-ink-850 px-4 py-2 text-[12.5px] text-mist-400 transition-colors hover:border-ink-600 hover:text-mist-200"
              >
                Start demo
              </button>
            </div>
          )}
          {status === "error" && (
            <button
              type="button"
              onClick={onRun}
              className="mt-4 w-full rounded-lg border border-ink-600 bg-ink-800 px-4 py-2.5 text-[13px] font-medium text-mist-200 transition-colors hover:border-accent-500 hover:text-accent-300"
            >
              Retry
            </button>
          )}
        </Section>

        {/* User control — context change */}
        {contextAlert && (
          <Section title="User control" tone="warn">
            <div className="fade-rise">
              <p className="text-[12.5px] font-medium text-warn-400">
                Context changed
              </p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-mist-300">
                {contextAlert.label.replace(/\?$/, "")} was{" "}
                {contextAlert.kind === "removed" ? "removed" : "edited"} after
                SCREENMATE filled it.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={onRestore}
                  className="rounded-md border border-ink-600 bg-ink-800 px-3 py-1.5 text-[12px] text-mist-200 transition-colors hover:border-accent-500 hover:text-accent-300"
                >
                  Restore value
                </button>
                <button
                  type="button"
                  onClick={onDismissAlert}
                  className="rounded-md border border-ink-700 px-3 py-1.5 text-[12px] text-mist-400 transition-colors hover:text-mist-200"
                >
                  Leave it
                </button>
              </div>
            </div>
          </Section>
        )}

        {/* Research */}
        {research && (
          <Section title="Research">
            <div className="flex items-center gap-2">
              <p className="text-[12.5px] font-medium text-mist-100">
                {state.company}
              </p>
              {research.degraded && (
                <span className="label-xs text-warn-400">partial</span>
              )}
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-mist-300">
              {research.companySummary}
            </p>

            {research.technicalFocus.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {research.technicalFocus.map((t) => (
                  <span
                    key={t}
                    className="rounded-md border border-accent-500/25 bg-accent-dim/60 px-2 py-0.5 text-[11px] text-accent-300"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}

            {research.sources.length > 0 && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setSourcesOpen((v) => !v)}
                  className="flex items-center gap-1 text-[11.5px] text-mist-400 transition-colors hover:text-mist-200"
                >
                  <ChevronRight
                    size={12}
                    strokeWidth={2.5}
                    className={`transition-transform duration-200 ${
                      sourcesOpen ? "rotate-90" : ""
                    }`}
                  />
                  {research.sources.length} source
                  {research.sources.length === 1 ? "" : "s"} used
                </button>

                {sourcesOpen && (
                  <ul className="fade-rise mt-2.5 space-y-2.5 border-l border-ink-700 pl-3">
                    {research.sources.map((s) => (
                      <li key={s.url}>
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="group flex items-start gap-1.5 text-[11.5px] leading-snug text-mist-200 transition-colors hover:text-accent-300"
                        >
                          <span className="min-w-0 break-words">{s.title}</span>
                          <ExternalLink
                            size={10}
                            strokeWidth={2}
                            className="mt-0.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                          />
                        </a>
                        <p className="label-xs mt-1 text-mist-500">{s.relevance}</p>
                        {s.excerpt && (
                          <p className="mt-1 text-[11px] leading-relaxed text-mist-500">
                            {s.excerpt}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Section>
        )}

        {/* Activity */}
        <div className="px-6 pt-5 pb-6">
          <p className="label-xs mb-3 text-mist-500">Recent activity</p>
          {activity.length === 0 ? (
            <p className="text-[12px] leading-relaxed text-mist-500">
              No activity yet. SCREENMATE will report every observation, decision,
              action, and verification here.
            </p>
          ) : (
            <ol className="space-y-3">
              {activity.map((entry) => {
                const Icon = ICONS[entry.kind];
                return (
                  <li
                    key={entry.id}
                    className={`fade-rise flex gap-2.5 ${
                      entry.nested ? "pl-5" : ""
                    }`}
                  >
                    <Icon
                      size={entry.nested ? 11 : 13}
                      strokeWidth={2}
                      className={`mt-0.5 shrink-0 ${ICON_TONE[entry.kind]} ${
                        entry.nested ? "opacity-70" : ""
                      }`}
                    />
                    <div className="min-w-0">
                      <p
                        className={`leading-snug ${
                          entry.nested
                            ? "text-[11.5px] text-mist-400"
                            : "text-[12.5px] text-mist-200"
                        }`}
                      >
                        {entry.message}
                      </p>
                      {entry.detail && (
                        <p className="mt-1 text-[11.5px] leading-relaxed break-words text-mist-500">
                          {entry.detail}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </aside>
  );
}

function Section({
  title,
  tone,
  children,
}: {
  title: string;
  tone?: "warn";
  children: React.ReactNode;
}) {
  return (
    <div
      className={`border-b px-6 py-5 ${
        tone === "warn"
          ? "border-warn-400/20 bg-warn-dim/25"
          : "border-ink-800"
      }`}
    >
      <p
        className={`label-xs mb-2.5 ${
          tone === "warn" ? "text-warn-400" : "text-mist-500"
        }`}
      >
        {title}
      </p>
      {children}
    </div>
  );
}

function StepMark({ status }: { status: PlanStep["status"] }) {
  if (status === "done") {
    return (
      <Check
        size={12}
        strokeWidth={3}
        className="mt-0.5 shrink-0 text-good-400"
      />
    );
  }
  if (status === "active") {
    return (
      <ArrowRight
        size={12}
        strokeWidth={2.5}
        className="mt-0.5 shrink-0 text-accent-400"
      />
    );
  }
  if (status === "skipped") {
    return (
      <Minus size={12} strokeWidth={2.5} className="mt-0.5 shrink-0 text-mist-600" />
    );
  }
  return (
    <Circle size={11} strokeWidth={2} className="mt-0.5 shrink-0 text-mist-600" />
  );
}
