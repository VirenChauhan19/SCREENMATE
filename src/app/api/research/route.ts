import { NextResponse } from "next/server";
import { preflight, requireKey, withCors } from "@/lib/auth";
import { z } from "zod";
import { completeJson } from "@/lib/openrouter";
import type { ResearchContext, ResearchSource } from "@/lib/types";

export const runtime = "nodejs";

const RequestSchema = z.object({
  company: z.string().min(1).max(120),
  role: z.string().min(1).max(120),
  roleId: z.string().max(60).optional(),
});

const NormalizedSchema = z.object({
  companySummary: z.string().min(1).max(700),
  technicalFocus: z.array(z.string().min(1).max(120)).max(6),
  relevantContext: z.array(z.string().min(1).max(240)).max(6),
  sources: z
    .array(
      z.object({
        index: z.number().int().min(1),
        relevance: z.string().min(1).max(90),
      }),
    )
    .max(6)
    .default([]),
});

interface ExaResult {
  title?: string;
  url?: string;
  summary?: string;
  text?: string;
}

/** Exa search + summaries. Returns null when Exa is unusable. */
async function searchExa(query: string): Promise<ExaResult[] | null> {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch("https://api.exa.ai/search", {
      method: "POST",
      signal: controller.signal,
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        numResults: 5,
        type: "auto",
        contents: {
          summary: {
            query:
              "What does this company build, what technologies do they use, and what do they look for in engineers?",
          },
        },
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: ExaResult[] };
    return Array.isArray(data.results) ? data.results : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Strips the label prefixes and list scaffolding Exa summaries often carry. */
function clean(raw: string): string {
  return raw
    .replace(/^\s*(summary|overview|key points)\s*:?\s*/i, "")
    .replace(/\s*\n\s*[-•*]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Truncates on a sentence boundary so text never ends mid-word. */
function toSentences(text: string, limit: number): string {
  if (!text) return "";
  if (text.length <= limit) return text;
  const window = text.slice(0, limit);
  const cut = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("! "),
    window.lastIndexOf("? "),
  );
  if (cut > limit * 0.4) return window.slice(0, cut + 1);
  const space = window.lastIndexOf(" ");
  return `${(space > 0 ? window.slice(0, space) : window).trimEnd()}…`;
}

/** Best-effort human label for a source, derived from its host. */
function sourceKind(url: string, title: string): string {
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  })();
  const t = `${title} ${url}`.toLowerCase();
  if (t.includes("career") || t.includes("job") || t.includes("intern"))
    return "Careers listing";
  if (t.includes("news") || t.includes("announce") || t.includes("press"))
    return "News coverage";
  if (t.includes("linkedin")) return "LinkedIn profile";
  if (host && t.includes(host.split(".")[0])) return "Company website";
  return host || "External source";
}

/** Used when the model is unavailable but Exa returned something. */
function heuristicNormalize(
  results: ExaResult[],
  company: string,
  role: string,
): Pick<
  ResearchContext,
  "companySummary" | "technicalFocus" | "relevantContext"
> {
  const summaries = results
    .map((r) => clean(r.summary ?? r.text ?? ""))
    .filter(Boolean);
  return {
    companySummary:
      toSentences(summaries[0] ?? "", 480) ||
      `Public sources describe ${company} as an engineering-led company hiring for ${role}.`,
    technicalFocus: [],
    relevantContext: summaries
      .slice(1, 4)
      .map((s) => toSentences(s, 200))
      .filter(Boolean),
  };
}

export function OPTIONS(request: Request) {
  return preflight(request);
}

export async function POST(request: Request) {
  const denied = requireKey(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return withCors(NextResponse.json(
      { error: "Invalid research request." },
      { status: 400 },
    ), request);
  }
  const { company, role, roleId } = parsed.data;

  const results = await searchExa(
    `${company} company engineering team technology stack ${role} hiring`,
  );

  if (!results || results.length === 0) {
    return withCors(NextResponse.json(
      {
        error: "External research unavailable",
        reason: process.env.EXA_API_KEY
          ? "Exa returned no usable results."
          : "EXA_API_KEY is not configured.",
      },
      { status: 503 },
    ), request);
  }

  const usable = results.filter((r) => r.url).slice(0, 4);

  // Sources are built from what Exa actually returned. Nothing here is invented;
  // the model may only attach a relevance line to an index that already exists.
  const baseSources: ResearchSource[] = usable.map((r) => ({
    title: (r.title || r.url) as string,
    url: r.url as string,
    excerpt: toSentences(clean(r.summary ?? r.text ?? ""), 180),
    relevance: sourceKind(r.url as string, r.title ?? ""),
  }));

  const rawContext = usable
    .map(
      (r, i) =>
        `[${i + 1}] ${r.title ?? "Untitled"} (${r.url ?? "no url"})\n${clean(
          r.summary ?? r.text ?? "",
        ).slice(0, 900)}`,
    )
    .join("\n\n");

  try {
    const normalized = await completeJson(
      [
        {
          role: "system",
          content:
            "You compress web research into a compact, factual briefing for a job applicant. " +
            "Use only what the provided sources support. Never invent products, funding, headcount, or sources. " +
            "Respond with JSON: " +
            '{"companySummary": string (2-3 sentences), "technicalFocus": string[] (3-5 short technology or domain labels), ' +
            '"relevantContext": string[] (2-4 one-line facts useful when explaining why someone wants this role), ' +
            '"sources": [{"index": number, "relevance": string}] — index refers to the numbered source above, ' +
            "relevance is at most 8 words on why that source mattered. Only reference indices that exist.",
        },
        {
          role: "user",
          content: `Company: ${company}\nRole: ${role}\n\nSources:\n${rawContext}`,
        },
      ],
      NormalizedSchema,
      { maxTokens: 900, temperature: 0.2 },
    );

    const sources = baseSources.map((s, i) => {
      const tagged = normalized.sources.find((x) => x.index === i + 1);
      return tagged ? { ...s, relevance: tagged.relevance } : s;
    });

    return withCors(NextResponse.json({
      companySummary: normalized.companySummary,
      technicalFocus: normalized.technicalFocus,
      relevantContext: normalized.relevantContext,
      sources,
      roleId,
    } satisfies ResearchContext), request);
  } catch {
    // Exa worked, the model did not. Ship the degraded-but-real briefing.
    return withCors(NextResponse.json({
      ...heuristicNormalize(results, company, role),
      sources: baseSources,
      degraded: true,
      roleId,
    } satisfies ResearchContext), request);
  }
}
