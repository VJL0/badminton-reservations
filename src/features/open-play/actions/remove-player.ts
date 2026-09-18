"use server";

import { idSchema } from "../schemas";
import { callRpc, invalid, type ActionResult } from "./rpc";

export async function removePlayer(sessionId: string, playerId: string): Promise<ActionResult> {
  const s = idSchema.safeParse(sessionId);
  const p = idSchema.safeParse(playerId);
  return s.success && p.success ? callRpc("remove_player", { p_session_id: s.data, p_player_id: p.data }) : invalid;
}
