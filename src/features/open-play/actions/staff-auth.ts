"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { checkRateLimit } from "@/lib/rate-limit";
import { verifyStaffCode } from "@/lib/staff-code";
import { clearStaffSession, createStaffSession } from "@/lib/staff-session";
import { firstIssue, staffCodeSchema } from "../schemas";
import type { FormState } from "./form-state";

/** Verifies the shared staff code server-side and, on success, opens a signed staff session. */
export async function verifyStaffCodeForm(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = staffCodeSchema.safeParse(String(formData.get("code") ?? ""));
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

  // Best-effort per-IP throttle: a shared code has no username to slow guessing down otherwise.
  // Trusts the platform's proxy (e.g. Vercel) to set x-forwarded-for; behind an untrusted proxy
  // this header is client-controlled and the limiter can be bypassed by varying it per request.
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!checkRateLimit(ip)) return { ok: false, error: "Too many attempts. Wait a few minutes and try again." };

  const hash = process.env.STAFF_ACCESS_CODE_HASH;
  if (!hash) return { ok: false, error: "Staff sign-in isn't configured on this server." };
  if (!verifyStaffCode(parsed.data, hash)) return { ok: false, error: "Wrong staff code." };

  await createStaffSession();
  return { ok: true };
}

export async function staffSignOut() {
  await clearStaffSession();
  redirect("/admin/login");
}
