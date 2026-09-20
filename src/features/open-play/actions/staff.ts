"use server";

import { refresh } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { emailSchema, idSchema, passwordSchema } from "../schemas";
import type { FormState } from "./form-state";
import { invalid, type ActionResult } from "./rpc";

// Shared starting password. Every account created or reset with it is flagged must_change_password
// (app_metadata is writable only with the service role) and the console nags until it's replaced.
const DEFAULT_PASSWORD = "Badminton144";

/** Server Actions are public endpoints: prove the caller is an ADMIN before touching auth. */
async function requireAdmin(): Promise<{ id: string } | null> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return null;
  const { error } = await supabase.rpc("list_staff"); // admin-only in the database
  return error ? null : { id: user.user.id };
}

const denied: ActionResult = { ok: false, error: "Only admins can do that." };
const unconfigured: ActionResult = { ok: false, error: "Admin management isn't configured on this server." };

export async function addAdmin(email: string): Promise<ActionResult> {
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  if (!(await requireAdmin())) return denied;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return unconfigured;

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: parsed.data,
    password: DEFAULT_PASSWORD,
    email_confirm: true,
    app_metadata: { must_change_password: true },
  });
  if (error || !data.user) {
    if (error?.code === "email_exists") return { ok: false, error: "That email already has an account." };
    console.error(`[staff] createUser failed: ${error?.code ?? ""} ${error?.message}`);
    return { ok: false, error: "Couldn't create the account." };
  }
  const { error: staffError } = await admin.from("staff").insert({ user_id: data.user.id, role: "ADMIN" });
  if (staffError) {
    console.error(`[staff] insert failed: ${staffError.message}`);
    await admin.auth.admin.deleteUser(data.user.id); // don't leave an orphan login behind
    return { ok: false, error: "Couldn't create the account." };
  }
  refresh();
  return { ok: true };
}

export async function resetAdminPassword(userId: string): Promise<ActionResult> {
  const id = idSchema.safeParse(userId);
  if (!id.success) return invalid;
  const me = await requireAdmin();
  if (!me) return denied;
  if (id.data === me.id) return { ok: false, error: "Use Change password for your own account." };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return unconfigured;

  const admin = createAdminClient();
  // Only staff accounts can be reset here, never arbitrary (player) users.
  const { data: row } = await admin.from("staff").select("user_id").eq("user_id", id.data).maybeSingle();
  if (!row) return invalid;
  const { error } = await admin.auth.admin.updateUserById(id.data, {
    password: DEFAULT_PASSWORD,
    app_metadata: { must_change_password: true },
  });
  if (error) {
    console.error(`[staff] reset failed: ${error.code ?? ""} ${error.message}`);
    return { ok: false, error: "Couldn't reset the password." };
  }
  return { ok: true };
}

export async function changeMyPassword(password: string): Promise<ActionResult> {
  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  if (parsed.data === DEFAULT_PASSWORD) return { ok: false, error: "Pick a password of your own." };

  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return { ok: false, error: "Please sign in again." };
  const { error } = await supabase.auth.updateUser({ password: parsed.data });
  if (error) return { ok: false, error: error.message };

  if (user.user.app_metadata?.must_change_password && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    await createAdminClient().auth.admin.updateUserById(user.user.id, {
      app_metadata: { ...user.user.app_metadata, must_change_password: false },
    });
    await supabase.auth.refreshSession(); // new JWT without the flag
  }
  refresh();
  return { ok: true };
}

export async function addAdminForm(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "");
  const res = await addAdmin(email);
  return res.ok ? { ok: true, message: "Admin added." } : { ok: false, error: res.error, values: { email } };
}

export async function changePasswordForm(_prev: FormState, formData: FormData): Promise<FormState> {
  const res = await changeMyPassword(String(formData.get("password") ?? ""));
  return res.ok ? { ok: true, message: "Password changed." } : { ok: false, error: res.error }; // never echo a password back
}
