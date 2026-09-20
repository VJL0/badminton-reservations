"use server";

import { idSchema } from "../schemas";
import { type ActionResult, callRpc, invalid } from "./rpc";

export async function finishRound(roundId: string): Promise<ActionResult> {
  const id = idSchema.safeParse(roundId);
  return id.success ? callRpc("finish_round", { p_round_id: id.data }) : invalid;
}
