"use server";

import { idSchema } from "../schemas";
import { type ActionResult, callRpc, invalid } from "./rpc";

export async function startRound(roundId: string): Promise<ActionResult> {
  const id = idSchema.safeParse(roundId);
  return id.success ? callRpc("start_round", { p_round_id: id.data }) : invalid;
}
