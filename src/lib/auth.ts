import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const SESSION_COOKIE = "screenmate_session";
export const SESSION_SECONDS = 12 * 60 * 60;
const HEADER = "x-screenmate-key";

/** Next's internal URL may use localhost even when the browser uses 127.0.0.1.
 * Use the direct Host header, never an untrusted forwarded-host chain. */
export function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("host");
  if (!host) return url.origin;
  try {
    const publicUrl = new URL(`${url.protocol}//${host}`);
    if (publicUrl.username || publicUrl.password || publicUrl.pathname !== "/" || publicUrl.search || publicUrl.hash || /[\s,]/.test(host)) return url.origin;
    return publicUrl.origin;
  } catch { return url.origin; }
}

function equal(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function isKeyRequired(): boolean {
  return Boolean(process.env.SCREENMATE_API_KEY);
}

export function validAccessKey(value: string | null): boolean {
  const expected = process.env.SCREENMATE_API_KEY;
  return Boolean(expected && value && equal(value, expected));
}

export function createSession(): string {
  const expires = String(Math.floor(Date.now() / 1000) + SESSION_SECONDS);
  const signature = createHmac("sha256", process.env.SCREENMATE_API_KEY!)
    .update(`screenmate-session:${expires}`).digest("base64url");
  return `${expires}.${signature}`;
}

export function hasSession(request: Request): boolean {
  if (!isKeyRequired()) return false;
  const token = (request.headers.get("cookie") || "").split(";")
    .map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (!token) return false;
  const [expires, signature, extra] = token.split(".");
  if (extra || !/^\d+$/.test(expires) || !signature || Number(expires) <= Date.now() / 1000) return false;
  const expected = createHmac("sha256", process.env.SCREENMATE_API_KEY!)
    .update(`screenmate-session:${expires}`).digest("base64url");
  return equal(signature, expected);
}

export function isLocalDevelopment(request: Request): boolean {
  return process.env.NODE_ENV !== "production" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname);
}

export function withCors(res: NextResponse, request: Request): NextResponse {
  const origin = request.headers.get("origin");
  if (origin?.startsWith("chrome-extension://")) res.headers.set("Access-Control-Allow-Origin", origin);
  res.headers.set("Access-Control-Allow-Headers", `Content-Type, ${HEADER}`);
  res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.headers.set("Access-Control-Max-Age", "86400");
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Vary", "Origin");
  return res;
}

export function preflight(request: Request): NextResponse {
  return withCors(new NextResponse(null, { status: 204 }), request);
}

/** Origin identifies a website; it is never a credential. */
export function requireKey(request: Request): NextResponse | null {
  if (!isKeyRequired()) {
    if (isLocalDevelopment(request)) return null;
    return withCors(NextResponse.json({ error: "Server setup incomplete", reason: "Set SCREENMATE_API_KEY on the server before using SCREENMATE." }, { status: 503 }), request);
  }
  if (validAccessKey(request.headers.get(HEADER))) return null;
  const origin = request.headers.get("origin");
  if (hasSession(request) && (!origin || origin === requestOrigin(request))) return null;
  return withCors(NextResponse.json({
    error: "Access key required",
    reason: "Unlock SCREENMATE on the setup page, or add the access key in the extension settings.",
  }, { status: 401 }), request);
}
