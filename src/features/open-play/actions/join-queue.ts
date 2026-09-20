"use server";

import { idSchema } from "../schemas";
import { callRpc, invalid, type ActionResult } from "./rpc";

/** Queue for the session, or for one specific court. Already queued? This just switches courts. */
export async function joinQueue(sessionId: string, courtId: string | null = null): Promise<ActionResult> {
  const s = idSchema.safeParse(sessionId);
  const c = courtId === null ? null : idSchema.safeParse(courtId);
  if (!s.success || (c && !c.success)) return invalid;
  // p_court_id omitted = any court
  return callRpc("join_queue", { p_session_id: s.data, p_court_id: c?.data });
}
