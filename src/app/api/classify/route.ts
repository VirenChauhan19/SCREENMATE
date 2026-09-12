import { NextResponse } from "next/server";
import { z } from "zod";
import { isSensitiveTopic, levelFor, topicFor } from "@/lib/policy";

export const runtime = "nodejs";

/**
 * Applies the policy layer to fields scraped from an arbitrary page.
 *
 * The Chrome extension holds no safety logic of its own: it sends what it found
 * in the DOM and this decides what may be touched. One copy of the policy, used
 * by both surfaces. If this endpoint is unreachable the extension fails closed
 * and treats every field as off-limits.
 */

const ScannedField = z.object({
  id: z.string().min(1).max(200),
  label: z.string().max(400).default(""),
  type: z.string().max(40).default("text"),
  required: z.boolean().default(false),
  options: z.array(z.string().max(200)).max(60).optional(),
});

const RequestSchema = z.object({
  fields: z.array(ScannedField).max(200),
});

const GENERIC_REASON =
  "This question touches a protected or personal topic. Only you can answer it.";

const SPECIFIC_REASONS: { match: RegExp; reason: string }[] = [
  {
    match: /sponsor|visa|work authori[sz]ation|citizenship|immigration/i,
    reason:
      "Immigration and work-authorization status is a legal declaration only you can make.",
  },
  {
    match: /salary|compensation|pay expectation/i,
    reason: "Compensation expectations are a negotiating position, not a stored fact.",
  },
  {
    match: /relocat/i,
    reason:
      "A relocation commitment is a personal obligation, not something inferable from your profile.",
  },
  {
    match: /disabilit|veteran|gender|race|ethnicit|demographic|date of birth/i,
    reason:
      "Protected-characteristic questions are yours alone, and always optional to answer.",
  },
  {
    match: /criminal|felony|conviction/i,
    reason: "A legal-history declaration can only be made by you.",
  },
];

function reasonFor(id: string, label: string): string {
  const haystack = `${id} ${label}`;
  return (
    SPECIFIC_REASONS.find((r) => r.match.test(haystack))?.reason ?? GENERIC_REASON
  );
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid classify request." }, { status: 400 });
  }

  const fields = parsed.data.fields.map((f) => {
    const level = levelFor(f.id, f.label, f.type);
    const sensitive = level === "sensitive";
    return {
      ...f,
      level,
      sensitive,
      sensitiveReason: sensitive ? reasonFor(f.id, f.label) : undefined,
      flaggedByTopic: isSensitiveTopic(f.id, f.label),
      // Lets the extension answer from a standing preference the user already set.
      topic: topicFor(f.id, f.label),
    };
  });

  return NextResponse.json({
    fields,
    counts: {
      total: fields.length,
      sensitive: fields.filter((f) => f.level === "sensitive").length,
      review: fields.filter((f) => f.level === "review").length,
      safe: fields.filter((f) => f.level === "safe").length,
    },
  });
}
