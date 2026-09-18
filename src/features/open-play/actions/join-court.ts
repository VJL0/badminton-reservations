"use server";

import { idSchema } from "../schemas";
import { callRpc, invalid, type ActionResult } from "./rpc";

export async function joinCourt(courtId: string): Promise<ActionResult> {
  const id = idSchema.safeParse(courtId);
  return id.success ? callRpc("join_court", { p_court_id: id.data }) : invalid;
}
