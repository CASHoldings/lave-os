import "server-only";
import { NextResponse } from "next/server";
import { isAppError } from "./errors";
import { logError } from "./log";

/** Route handlers have no built-in CSRF check, so state-changing ones verify the Origin header. */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

const statusFor: Record<string, number> = { not_found: 404, forbidden: 403, unauthenticated: 401, validation: 422, conflict: 409, rate_limited: 429, unavailable: 503 };

export function errorResponse(name: string, error: unknown) {
  if (isAppError(error)) {
    return NextResponse.json({ message: error.message, fieldErrors: error.fieldErrors }, { status: statusFor[error.code] ?? 400, headers: { "Cache-Control": "no-store" } });
  }
  logError(`route.${name}.failed`, error);
  return NextResponse.json({ message: "Something went wrong. Please try again." }, { status: 500, headers: { "Cache-Control": "no-store" } });
}

export function redirectNoStore(url: string, base: string) {
  const res = NextResponse.redirect(new URL(url, base), 302);
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}
