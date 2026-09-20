import "server-only";
import { appUrlFor } from "@/lib/env.server";
import { createPrivilegedSupabaseClient, privilegedClientConfigured } from "@/lib/supabase/privileged";
import { createClient } from "@/lib/supabase/server";
import { emailSchema, firstIssue, passwordSchema } from "../schemas";
import { requireAdmin, requireStaff } from "./auth";
import { type ActionResult, denied, invalid } from "./errors";
import { listStaff } from "./queries";

const unconfigured: ActionResult = { ok: false, error: "Admin management isn't configured on this server." };

/**
 * Invite someone as an admin, or send a pending invitation again. Supabase emails them a link to
 * /admin/onboarding where they choose their own password: no password is ever created for them, so there is
 * no shared or default credential to leak. Safe to repeat: inviting the same unconfirmed email again re-sends
 * the mail and returns the same account, and granting the role twice changes nothing.
 */
export async function inviteAdmin(email: string): Promise<ActionResult> {
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  if (!(await requireAdmin())) return denied;
  if (!privilegedClientConfigured()) return unconfigured;

  const client = createPrivilegedSupabaseClient();
  const { data, error } = await client.auth.admin.inviteUserByEmail(parsed.data, { redirectTo: appUrlFor("/admin/onboarding") });
  if (error || !data.user) {
    if (error?.code === "email_exists") return { ok: false, error: "That email already has an account." };
    console.error(`[staff] invite failed: ${error?.code ?? ""} ${error?.message}`);
    return { ok: false, error: "Couldn't send the invitation." };
  }
  const { error: grantError } = await client.rpc("grant_staff", { p_user_id: data.user.id, p_role: "ADMIN" });
  if (grantError) {
    console.error(`[staff] grant failed: ${grantError.message}`);
    return { ok: false, error: "The invitation went out but access couldn't be granted. Send it again." };
  }
  return { ok: true };
}

/** Send the invitation again to an admin who never signed in. Only staff accounts can be targeted, never players. */
export async function resendInvite(userId: string): Promise<ActionResult> {
  if (!(await requireAdmin())) return denied;
  const member = (await listStaff(await createClient())).find((m) => m.user_id === userId);
  if (!member?.email || member.last_sign_in_at) return invalid;
  return inviteAdmin(member.email);
}

/** An officer changes their own password (they signed in, so this is an authenticated call, not a reset). */
export async function changeOwnPassword(password: string): Promise<ActionResult> {
  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  if (!(await requireStaff())) return { ok: false, error: "Please sign in again." };

  const { error } = await (await createClient()).auth.updateUser({ password: parsed.data });
  return error ? { ok: false, error: error.message } : { ok: true };
}
