import { NextResponse } from "next/server";
import { z } from "zod";
import { preflight, requireKey, withCors } from "@/lib/auth";
import { OpenRouterError, completeJson } from "@/lib/openrouter";
import { extractText, kindFromName } from "@/lib/cv";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 6 * 1024 * 1024;

/**
 * Every field is optional and nullable on purpose: a CV that does not mention a
 * minor must come back with no minor, not an invented one.
 */
const ProfileSchema = z.object({
  name: z.string().max(120).nullish(),
  email: z.string().max(160).nullish(),
  phone: z.string().max(60).nullish(),
  location: z.string().max(120).nullish(),
  university: z.string().max(160).nullish(),
  degree: z.string().max(160).nullish(),
  minor: z.string().max(120).nullish(),
  graduationDate: z.string().max(40).nullish(),
  portfolio: z.string().max(300).nullish(),
  linkedin: z.string().max(300).nullish(),
  github: z.string().max(300).nullish(),
  skills: z.array(z.string().min(1).max(60)).max(40).default([]),
  /** Fields the CV genuinely did not contain, so the UI can flag them. */
  missing: z.array(z.string().max(40)).max(20).default([]),
});

export function OPTIONS(request: Request) {
  return preflight(request);
}

export async function POST(request: Request) {
  const denied = requireKey(request);
  if (denied) return denied;

  let file: File | null = null;
  try {
    const form = await request.formData();
    const candidate = form.get("cv");
    if (candidate instanceof File) file = candidate;
  } catch {
    file = null;
  }

  if (!file) {
    return withCors(
      NextResponse.json({ error: "No CV file received." }, { status: 400 }),
      request,
    );
  }
  if (file.size > MAX_BYTES) {
    return withCors(
      NextResponse.json(
        { error: "That file is over 6MB.", reason: "Try exporting a smaller PDF." },
        { status: 413 },
      ),
      request,
    );
  }

  const kind = kindFromName(file.name, file.type || "");
  if (!kind) {
    return withCors(
      NextResponse.json(
        {
          error: "Unsupported file type.",
          reason: "Upload a PDF, DOCX, or plain text CV.",
        },
        { status: 415 },
      ),
      request,
    );
  }

  let text = "";
  try {
    text = (await extractText(await file.arrayBuffer(), kind)).trim();
  } catch (err) {
    console.error("[screenmate:parse-cv]", err);
    return withCors(
      NextResponse.json(
        {
          error: "Could not read that file.",
          reason:
            kind === "pdf"
              ? "Scanned or image-only PDFs have no text layer. Export a text PDF, or paste the text instead."
              : "The file could not be decoded.",
        },
        { status: 422 },
      ),
      request,
    );
  }

  if (text.length < 80) {
    return withCors(
      NextResponse.json(
        {
          error: "That file had almost no readable text.",
          reason:
            "If it is a scanned CV, the page is an image. Export a text PDF or paste the text.",
        },
        { status: 422 },
      ),
      request,
    );
  }

  try {
    const profile = await completeJson(
      [
        {
          role: "system",
          content: [
            "You extract a structured profile from a CV. You are a parser, not a writer.",
            "",
            "RULES:",
            "1. Copy values verbatim from the CV. Never rephrase, expand, normalise, or infer.",
            "2. If the CV does not state something, return null for it and add its key to `missing`. Never guess a graduation year, a location, or a URL.",
            "3. skills: only technologies, languages, tools and frameworks the CV actually names. No soft skills, no duties, no inferred adjacents. At most 25, most relevant first.",
            "4. degree is the qualification ('BFA Game Design'), university is the institution.",
            "5. graduationDate: whatever form the CV uses ('2027', 'May 2026', 'Expected 2027').",
            "6. URLs: return them as written. Add https:// only if the CV shows a bare domain.",
            "",
            "These values get typed into real job applications, so an invented one is worse than a missing one.",
            "",
            'OUTPUT JSON only: {"name","email","phone","location","university","degree","minor","graduationDate","portfolio","linkedin","github","skills":[],"missing":[]}',
          ].join("\n"),
        },
        { role: "user", content: `CV TEXT:\n\n${text.slice(0, 14000)}` },
      ],
      ProfileSchema,
      { maxTokens: 1200, temperature: 0 },
    );

    const clean = <T,>(v: T | null | undefined) =>
      typeof v === "string" ? (v.trim() || undefined) : (v ?? undefined);

    return withCors(
      NextResponse.json({
        profile: {
          name: clean(profile.name),
          email: clean(profile.email),
          phone: clean(profile.phone),
          location: clean(profile.location),
          university: clean(profile.university),
          degree: clean(profile.degree),
          minor: clean(profile.minor),
          graduationDate: clean(profile.graduationDate),
          portfolio: clean(profile.portfolio),
          linkedin: clean(profile.linkedin),
          github: clean(profile.github),
          skills: profile.skills,
        },
        missing: profile.missing,
        chars: text.length,
        source: file.name,
      }),
      request,
    );
  } catch (err) {
    const status = err instanceof OpenRouterError ? err.status : 502;
    console.error("[screenmate:parse-cv]", err);
    return withCors(
      NextResponse.json(
        {
          error: "Could not extract a profile from that CV.",
          reason:
            err instanceof OpenRouterError ? err.message : "Unexpected parser failure.",
        },
        { status },
      ),
      request,
    );
  }
}
