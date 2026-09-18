"use server";

import { idSchema } from "../schemas";
import { callRpc, invalid, type ActionResult } from "./rpc";

export async function leaveQueue(sessionId: string): Promise<ActionResult> {
  const id = idSchema.safeParse(sessionId);
  return id.success ? callRpc("leave_queue", { p_session_id: id.data }) : invalid;
}
