"use server";

import { idSchema } from "../schemas";
import { type ActionResult, callStaffOrSelfRpc, invalid } from "./rpc";

export async function finishRound(roundId: string): Promise<ActionResult> {
  const id = idSchema.safeParse(roundId);
  return id.success ? callStaffOrSelfRpc("finish_round", { p_round_id: id.data }) : invalid;
}
