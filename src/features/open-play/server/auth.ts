import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { type StaffRole, staffRoleSchema } from "../schemas";
import { rpc } from "./db";

export type Identity = { id: string; role: StaffRole | null; anonymous: boolean };

/**
 * Who is calling: the verified JWT claims (checked locally, no round trip) and the staff role the database
 * assigns them. Null when nobody is signed in. Memoized per request.
 */
export const getIdentity = cache(async (): Promise<Identity | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims) return null;
  const parsed = staffRoleSchema.safeParse(await rpc(supabase, "current_staff_role").catch(() => null));
  return { id: claims.sub, role: parsed.success ? parsed.data : null, anonymous: claims.is_anonymous === true };
});

// Authorization is checked twice on purpose: here, so a refused call never reaches the database and can say why,
// and again inside every staff-only function, so the database never trusts the app to have asked.

/** An officer or an admin, or null. */
export async function requireStaff(): Promise<(Identity & { role: StaffRole }) | null> {
  const me = await getIdentity();
  return me?.role ? (me as Identity & { role: StaffRole }) : null;
}

/** An admin, or null. */
export async function requireAdmin(): Promise<(Identity & { role: "ADMIN" }) | null> {
  const me = await getIdentity();
  return me?.role === "ADMIN" ? (me as Identity & { role: "ADMIN" }) : null;
}
