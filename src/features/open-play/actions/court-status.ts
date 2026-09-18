"use server";

import { idSchema } from "../schemas";
import { callRpc, invalid, type ActionResult } from "./rpc";

export async function setCourtPaused(courtId: string, paused: boolean): Promise<ActionResult> {
  const id = idSchema.safeParse(courtId);
  if (!id.success) return invalid;
  return callRpc(paused ? "pause_court" : "resume_court", { p_court_id: id.data });
}
