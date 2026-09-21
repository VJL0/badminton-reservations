import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  activeSessionCodeSchema,
  displayNameSchema,
  opsHealthSchema,
  type Snapshot,
  type Summary,
  sessionListSchema,
  snapshotSchema,
  staffListSchema,
  summarySchema,
} from "../schemas";
import { rpc, type Supabase } from "./db";

// Everything a page reads goes through here: one call, one runtime-checked shape. If the SQL and these schemas
// ever drift apart, the mismatch is an immediate, named error, not a wrong number on somebody's phone.

/** The code of the live session, or null when nothing is running. Only one session is live at a time. */
export async function getActiveSessionCode(supabase?: Supabase): Promise<string | null> {
  return activeSessionCodeSchema.parse(await rpc(supabase ?? (await createClient()), "get_active_session_code"));
}

/** The name this login has saved, or null before they have entered one. Needs a signed-in user. */
export async function getDisplayName(supabase: Supabase): Promise<string | null> {
  return displayNameSchema.parse(await rpc(supabase, "get_display_name"));
}

/** The board of a session by its QR code, or null when there is no such session. */
export async function getSessionSnapshot(supabase: Supabase, code: string): Promise<Snapshot | null> {
  const data = await rpc(supabase, "get_snapshot", { p_code: code });
  return data === null ? null : snapshotSchema.parse(data);
}

export async function listSessions(supabase: Supabase) {
  return sessionListSchema.parse(await rpc(supabase, "list_sessions"));
}

/** The summary of a session, or null when there is no such session. */
export async function getSessionSummary(supabase: Supabase, sessionId: string): Promise<Summary | null> {
  const data = await rpc(supabase, "get_session_summary", { p_session_id: sessionId });
  return data === null ? null : summarySchema.parse(data);
}

export async function listStaff(supabase: Supabase) {
  return staffListSchema.parse(await rpc(supabase, "list_staff"));
}

export async function getOpsHealth(supabase: Supabase) {
  return opsHealthSchema.parse(await rpc(supabase, "ops_health"));
}
