"use server";

import { idSchema } from "../schemas";
import { type ActionResult, callRpc, invalid } from "./rpc";

export async function leaveQueue(sessionId: string): Promise<ActionResult> {
  const id = idSchema.safeParse(sessionId);
  return id.success ? callRpc("leave_queue", { p_session_id: id.data }) : invalid;
}
