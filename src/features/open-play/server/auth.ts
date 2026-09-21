import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { type StaffRole, staffRoleSchema } from "../schemas";
import { rpc } from "./db";

export type Identity = { id: string; email: string | null; role: StaffRole | null; anonymous: boolean };

/**
 * Who is calling: the verified JWT claims (checked locally, no round trip) and the staff role the database
 * assigns them. Null when nobody is signed in. Memoized per request.
 *
 * Signing in with Google proves who someone is and nothing more. A signed-in person without a role asks the
 * database to link them to what an admin authorized for their verified email (`claim_staff_access`); that is how
 * a first sign-in becomes staff access, and how an authorization added later takes effect. Players are anonymous
 * and skip the question.
 */
export const getIdentity = cache(async (): Promise<Identity | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims) return null;
  const anonymous = claims.is_anonymous === true;

  let role = staffRoleSchema.safeParse(await rpc(supabase, "current_staff_role").catch(() => null));
  if (!role.success && !anonymous) role = staffRoleSchema.safeParse(await rpc(supabase, "claim_staff_access").catch(() => null));
  return {
    id: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
    role: role.success ? role.data : null,
    anonymous,
  };
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
