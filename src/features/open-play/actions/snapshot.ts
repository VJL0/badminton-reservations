"use server";

import { hasStaffSession } from "@/lib/staff-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { sessionCodeSchema } from "../schemas";
import type { Snapshot } from "../types";

/**
 * Staff-only path for refreshing the live board client-side: a staff-only browser has no
 * anonymous Supabase session, so it can't call `get_snapshot` directly with the anon key.
 * Players keep calling the RPC directly from the browser (see `useSessionRealtime`).
 */
export async function getSnapshotAction(code: string): Promise<{ data: Snapshot | null; error: { message: string } | null }> {
  if (!(await hasStaffSession())) return { data: null, error: { message: "not_staff" } };
  const parsed = sessionCodeSchema.safeParse(code);
  if (!parsed.success) return { data: null, error: { message: "invalid_request" } };

  const { data, error } = await createAdminClient().rpc("get_snapshot", { p_code: parsed.data });
  return { data: (data as Snapshot | null) ?? null, error: error ? { message: error.message } : null };
}
