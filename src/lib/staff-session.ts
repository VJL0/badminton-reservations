import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Route } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const COOKIE_NAME = "staff_session";
// Fixed from sign-in, not renewed on activity: staff re-enter the code once every 30 days, not 30
// days after their last visit. Good enough for how rarely this is used; a sliding session would need
// to re-issue the cookie on each request, which Server Components can't do (only Actions/Route Handlers can).
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 30;

function secret(): string {
  const value = process.env.STAFF_SESSION_SECRET;
  if (!value) throw new Error("STAFF_SESSION_SECRET is not set. See .env.example.");
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function tokenFor(expiresAtMs: number): string {
  const payload = String(expiresAtMs);
  return `${payload}.${sign(payload)}`;
}

function isValidToken(value: string | undefined): boolean {
  if (!value) return false;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return false;
  const expiresAtMs = Number(payload);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs < Date.now()) return false;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/** Sets the signed staff session cookie. Called after a successful code check, in a Server Action. */
export async function createStaffSession(): Promise<void> {
  const jar = await cookies();
  const token = tokenFor(Date.now() + SESSION_DURATION_SECONDS * 1000);
  jar.set(COOKIE_NAME, token, cookieOptions(SESSION_DURATION_SECONDS));
}

export async function clearStaffSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

export async function hasStaffSession(): Promise<boolean> {
  const jar = await cookies();
  return isValidToken(jar.get(COOKIE_NAME)?.value);
}

/** For Server Components: redirects to sign-in when there's no valid staff session. */
export async function requireStaffSession(loginUrl: Route = "/admin/login"): Promise<void> {
  if (!(await hasStaffSession())) redirect(loginUrl);
}
