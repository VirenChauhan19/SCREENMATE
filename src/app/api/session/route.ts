import { NextResponse } from "next/server";
import { createSession, hasSession, isKeyRequired, isLocalDevelopment, SESSION_COOKIE, SESSION_SECONDS, validAccessKey } from "@/lib/auth";

export const runtime = "nodejs";

export function GET(request: Request) {
  return NextResponse.json({ authenticated: hasSession(request) || (!isKeyRequired() && isLocalDevelopment(request)) }, { headers: { "Cache-Control": "no-store" } });
}

export function POST(request: Request) {
  if (!isKeyRequired()) {
    return NextResponse.json({ authenticated: isLocalDevelopment(request), error: "Set SCREENMATE_API_KEY on the server." }, { status: isLocalDevelopment(request) ? 200 : 503 });
  }
  if (!validAccessKey(request.headers.get("x-screenmate-key"))) {
    return NextResponse.json({ error: "That access key was not accepted." }, { status: 401 });
  }
  const response = NextResponse.json({ authenticated: true });
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(SESSION_COOKIE, createSession(), {
    httpOnly: true, secure: new URL(request.url).protocol === "https:",
    sameSite: "strict", path: "/", maxAge: SESSION_SECONDS,
  });
  return response;
}

export function DELETE() {
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 });
  return response;
}
