"use client";

import { Check, Lock, Sparkles, TriangleAlert } from "lucide-react";
import type { ApplicationField, ValidationError } from "@/lib/types";

interface Props {
  field: ApplicationField;
  errors: ValidationError[];
  highlight: boolean;
  onChange: (value: string) => void;
}

export function FormField({ field, errors, highlight, onChange }: Props) {
  const filled = field.value !== null && field.value.trim().length > 0;
  const blocker = errors.find((e) => e.severity !== "warning");
  const warning = errors.find((e) => e.severity === "warning");

  const cls = [
    "field-base",
    highlight ? "agent-write" : "",
    blocker ? "!border-bad-400/60" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={field.type === "textarea" ? "sm:col-span-2" : ""}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label
          htmlFor={field.id}
          className="text-[12.5px] leading-tight font-medium text-mist-300"
        >
          {field.label}
          {field.required && <span className="ml-1 text-mist-500">*</span>}
        </label>
        <FieldBadge field={field} filled={filled} />
      </div>

      {field.type === "textarea" ? (
        <textarea
          id={field.id}
          rows={5}
          className={`${cls} resize-y leading-relaxed`}
          placeholder={field.placeholder}
          value={field.value ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : field.type === "select" ? (
        <div className="flex gap-2">
          {(field.options ?? []).map((opt) => {
            const active = field.value === opt;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => onChange(active ? "" : opt)}
                className={[
                  "min-w-20 rounded-lg border px-4 py-2 text-[13px] font-medium transition-all duration-200",
                  active
                    ? "border-accent-500 bg-accent-dim text-accent-300"
                    : "border-ink-700 bg-ink-850 text-mist-400 hover:border-ink-600 hover:text-mist-200",
                  highlight && active ? "agent-write" : "",
                ].join(" ")}
              >
                {opt}
              </button>
            );
          })}
        </div>
      ) : (
        <input
          id={field.id}
          type={field.type === "email" ? "email" : "text"}
          className={cls}
          placeholder={field.placeholder}
          value={field.value ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {field.type === "tags" && filled && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(field.value ?? "")
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
            .map((tag) => (
              <span
                key={tag}
                className="rounded-md border border-ink-700 bg-ink-800 px-2 py-0.5 text-[11px] text-mist-300"
              >
                {tag}
              </span>
            ))}
        </div>
      )}

      {blocker && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-bad-400">
          <TriangleAlert size={12} strokeWidth={2} />
          {blocker.message}
        </p>
      )}
      {!blocker && warning && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-warn-400">
          <TriangleAlert size={12} strokeWidth={2} />
          {warning.message}
        </p>
      )}
    </div>
  );
}

/**
 * One badge per field, reflecting the policy level and — once the agent has
 * written a value — how directly that value traces back to the profile.
 */
function FieldBadge({ field, filled }: { field: ApplicationField; filled: boolean }) {
  if (field.level === "sensitive" && !filled) {
    return (
      <Badge tone="warn" icon={<Lock size={10} strokeWidth={2.5} />}>
        User decision required
      </Badge>
    );
  }

  if (!field.filledByAgent || !filled) return null;

  if (field.confidence === "medium") {
    return (
      <Badge
        tone={field.reviewed ? "good" : "accent"}
        icon={
          field.reviewed ? (
            <Check size={11} strokeWidth={3} />
          ) : (
            <Sparkles size={10} strokeWidth={2.5} />
          )
        }
        title="Assembled by the agent rather than copied verbatim."
      >
        {field.reviewed ? "Reviewed" : "Review recommended"}
      </Badge>
    );
  }

  return (
    <Badge
      tone="good"
      icon={<Check size={11} strokeWidth={3} />}
      title="Copied verbatim from your saved profile."
    >
      Agent completed
    </Badge>
  );
}

function Badge({
  tone,
  icon,
  children,
  title,
}: {
  tone: "good" | "warn" | "accent";
  icon: React.ReactNode;
  children: React.ReactNode;
  title?: string;
}) {
  const toneCls = {
    good: "text-good-400",
    warn: "text-warn-400",
    accent: "text-accent-300",
  }[tone];
  return (
    <span
      title={title}
      className={`label-xs flex shrink-0 items-center gap-1 ${toneCls}`}
    >
      {icon}
      {children}
    </span>
  );
}
