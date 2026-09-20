"use server";

import { idSchema } from "../schemas";
import { removePlayer as command } from "../server/commands";
import { invalid } from "../server/errors";
import type { ActionResult } from "./result";

/** `participantId` is the id the board shows for the person, not their login. */
export async function removePlayer(sessionId: string, participantId: string): Promise<ActionResult> {
  const s = idSchema.safeParse(sessionId);
  const p = idSchema.safeParse(participantId);
  return s.success && p.success ? command(s.data, p.data) : invalid;
}
