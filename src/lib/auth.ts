import { NextResponse } from "next/server";

/**
 * Access control for the hosted API.
 *
 * Running on localhost these routes are effectively private. The moment they
 * are deployed they are a public endpoint spending real OpenRouter and Exa
 * credits, so a shared secret gates them.
 *
 * This is not a secret from the user — they paste it into the extension once.
 * It is a secret from everyone who happens to find the URL.
 */

const HEADER = "x-screenmate-key";

/** Extensions get a stable chrome-extension:// origin; browsers do not. */
function corsHeaders(origin: string | null): Record<string, string> {
  const allowed =
    origin && (origin.startsWith("chrome-extension://") || origin === "null")
      ? origin
      : "*";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": `Content-Type, ${HEADER}`,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function withCors(res: NextResponse, request: Request): NextResponse {
  for (const [k, v] of Object.entries(corsHeaders(request.headers.get("origin")))) {
    res.headers.set(k, v);
  }
  return res;
}

export function preflight(request: Request): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request.headers.get("origin")),
  });
}

/**
 * Returns a 401 response when the caller is not authorised, or null when it is.
 *
 * If SCREENMATE_API_KEY is unset the gate is open — that keeps local development
 * frictionless. Production sets it, and `/api/health` reports which mode is live
 * so a misconfigured deploy is obvious rather than silently public.
 */
export function requireKey(request: Request): NextResponse | null {
  const expected = process.env.SCREENMATE_API_KEY;
  if (!expected) return null;

  const provided = request.headers.get(HEADER);
  if (provided && timingSafeEqual(provided, expected)) return null;

  // The bundled web demo is served from this same deployment and calls these
  // routes from the browser, where it cannot hold a secret. Same-origin
  // requests are therefore allowed through.
  //
  // Be clear about what that is worth: an Origin header can be forged, so this
  // is a deterrent against a shared URL quietly spending your credits, not a
  // defence against someone who actually wants in. Rate limiting at the edge
  // is the real control.
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host) {
    try {
      if (new URL(origin).host === host) return null;
    } catch {
      /* malformed origin: fall through to the 401 */
    }
  }

  return withCors(
    NextResponse.json(
      {
        error: "Not authorised",
        reason:
          "This SCREENMATE backend requires an access key. Add it in the extension popup.",
      },
      { status: 401 },
    ),
    request,
  );
}

export function isKeyRequired(): boolean {
  return Boolean(process.env.SCREENMATE_API_KEY);
}

/** Constant-time compare so the key cannot be guessed a character at a time. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
