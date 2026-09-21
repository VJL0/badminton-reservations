"use server";

import { refresh } from "next/cache";
import { authorizeStaffSchema, emailSchema, firstIssue } from "../schemas";
import { authorizeStaff, revokeStaff as revoke } from "../server/commands";
import { invalid } from "../server/errors";
import type { FormState } from "./form-state";
import type { ActionResult } from "./result";

/** The "Add staff" form: authorize an email for a role. Nothing is sent to them; they just sign in with Google. */
export async function authorizeStaffForm(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = { email: String(formData.get("email") ?? ""), role: String(formData.get("role") ?? "") };
  const parsed = authorizeStaffSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error), values };
  const res = await authorizeStaff(parsed.data.email, parsed.data.role);
  if (!res.ok) return { ok: false, error: res.error, values };
  refresh();
  return { ok: true, message: `${parsed.data.email} can now sign in with Google.` };
}

export async function revokeStaff(email: string): Promise<ActionResult> {
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) return invalid;
  const res = await revoke(parsed.data);
  refresh();
  return res;
}
