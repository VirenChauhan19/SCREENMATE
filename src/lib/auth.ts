import { NextResponse } from "next/server";
import { createHmac, randomBytes, timingSafeEqual as cryptoEqual } from "node:crypto";

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
export const SESSION_COOKIE = "screenmate_session";
export const SESSION_SECONDS = 8 * 60 * 60;

export function sameOrigin(request: Request): boolean {
  return request.headers.get("origin") === new URL(request.url).origin;
}

export function createSession(): string {
  const key = process.env.SCREENMATE_API_KEY;
  if (!key) throw new Error("Access key is not configured");
  const payload = `${Date.now() + SESSION_SECONDS * 1000}.${randomBytes(24).toString("hex")}`;
  return `${payload}.${createHmac("sha256", key).update(payload).digest("hex")}`;
}

export function hasSession(request: Request): boolean {
  const key = process.env.SCREENMATE_API_KEY;
  if (!key) return false;
  const token = request.headers.get("cookie")?.split(";").map(c => c.trim())
    .find(c => c.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  if (!token || token.length > 200) return false;
  const [expires, nonce, signature, extra] = token.split(".");
  if (extra || !/^\d+$/.test(expires) || !/^[a-f0-9]{48}$/.test(nonce || "") ||
      Number(expires) <= Date.now() || Number(expires) > Date.now() + SESSION_SECONDS * 1000) return false;
  const expected = createHmac("sha256", key).update(`${expires}.${nonce}`).digest("hex");
  return timingSafeEqual(signature || "", expected);
}

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
 * Development may run without a key. Production fails closed when the key is
 * missing. Browser clients authenticate with signed sessions; extensions use
 * the access-key header.
 */
export function requireKey(request: Request): NextResponse | null {
  const expected = process.env.SCREENMATE_API_KEY;
  if (!expected) {
    if (process.env.NODE_ENV !== "production") return null;
    return withCors(NextResponse.json({ error: "Backend access is not configured.",
      reason: "Set SCREENMATE_API_KEY on the server." }, { status: 503 }), request);
  }

  const provided = request.headers.get(HEADER);
  if (provided && timingSafeEqual(provided, expected)) return null;

  // Origin is a CSRF check, never authentication. The web UI must first
  // exchange its key for a signed, expiring HttpOnly session cookie.
  if (sameOrigin(request) && hasSession(request)) return null;

  return withCors(
    NextResponse.json(
      {
        error: "Not authorised",
        reason:
          "This SCREENMATE backend requires an access key. Sign in to the web app or add it in extension settings.",
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
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && cryptoEqual(left, right);
}
