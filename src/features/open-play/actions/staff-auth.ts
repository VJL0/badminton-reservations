"use server";

import { headers } from "next/headers";
import { checkRateLimit } from "@/lib/rate-limit";
import { verifyStaffCode } from "@/lib/staff-code";
import { clearStaffSession, createStaffSession } from "@/lib/staff-session";
import { firstIssue, staffCodeSchema } from "../schemas";
import type { FormState } from "./form-state";

/** Checks the staff code and sets the staff cookie, which re-renders the current page. */
export async function verifyStaffCodeForm(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = staffCodeSchema.safeParse(String(formData.get("code") ?? ""));
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

  // Per-IP throttle. Trusts the platform (e.g. Vercel) to set x-forwarded-for.
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
}
