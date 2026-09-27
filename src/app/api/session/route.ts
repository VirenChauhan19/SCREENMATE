import { NextResponse } from "next/server";
import { createSession, hasSession, requireKey, sameOrigin, SESSION_COOKIE, SESSION_SECONDS } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const localOpen = process.env.NODE_ENV !== "production" && !process.env.SCREENMATE_API_KEY;
  return NextResponse.json({ authenticated: localOpen || hasSession(request) },
    { headers: { "Cache-Control": "no-store" } });
}

export function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Open sign-in from this app." }, { status: 403 });
  const denied = requireKey(request);
  if (denied) return denied;
  const response = NextResponse.json({ authenticated: true });
  response.headers.set("Cache-Control", "no-store");
  if (process.env.SCREENMATE_API_KEY) response.cookies.set(SESSION_COOKIE, createSession(), {
    httpOnly: true, secure: new URL(request.url).protocol === "https:",
    sameSite: "strict", path: "/", maxAge: SESSION_SECONDS,
  });
  return response;
}

export function DELETE(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 });
  return response;
}
