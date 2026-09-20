"use server";

import { idSchema } from "../schemas";
import { callRpc, invalid, type ActionResult } from "./rpc";

/** Stop or restart a running game's clock. */
export async function setRoundPaused(roundId: string, paused: boolean): Promise<ActionResult> {
  const id = idSchema.safeParse(roundId);
  if (!id.success) return invalid;
  return callRpc(paused ? "pause_round" : "resume_round", { p_round_id: id.data });
}
