import { NextResponse } from "next/server";
import { isKeyRequired, preflight, withCors } from "@/lib/auth";

export const runtime = "nodejs";

export function OPTIONS(request: Request) {
  return preflight(request);
}

/**
 * Unauthenticated on purpose: the extension needs to tell "backend is down"
 * apart from "backend is up but my key is wrong", and a deploy that silently
 * forgot its credentials should be visible rather than mysterious.
 *
 * It reports whether each credential is present, never what it is.
 */
export function GET(request: Request) {
  return withCors(
    NextResponse.json({
      ok: true,
      service: "screenmate",
      requiresKey: isKeyRequired(),
      configured: {
        openrouter: Boolean(process.env.OPENROUTER_API_KEY),
        exa: Boolean(process.env.EXA_API_KEY),
      },
      model: process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4.5",
    }),
    request,
  );
}
