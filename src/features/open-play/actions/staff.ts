"use server";

import { refresh } from "next/cache";
import { idSchema } from "../schemas";
import { invalid } from "../server/errors";
import { changeOwnPassword, inviteAdmin, resendInvite as resend } from "../server/staff";
import type { FormState } from "./form-state";
import type { ActionResult } from "./result";

export async function inviteAdminForm(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "");
  const res = await inviteAdmin(email);
  if (res.ok) refresh();
  return res.ok
    ? { ok: true, message: "Invitation sent. They choose their own password from the email." }
    : { ok: false, error: res.error, values: { email } };
}

export async function resendInvite(userId: string): Promise<ActionResult> {
  const id = idSchema.safeParse(userId);
  return id.success ? resend(id.data) : invalid;
}

export async function changePasswordForm(_prev: FormState, formData: FormData): Promise<FormState> {
  const res = await changeOwnPassword(String(formData.get("password") ?? ""));
  return res.ok ? { ok: true, message: "Password changed." } : { ok: false, error: res.error }; // never echo a password back
}
