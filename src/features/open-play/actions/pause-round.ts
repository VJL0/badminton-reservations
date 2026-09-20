"use server";

import { idSchema } from "../schemas";
import { setRoundPaused as command } from "../server/commands";
import { invalid } from "../server/errors";
import type { ActionResult } from "./result";

/** Stop or restart a running game's clock. */
export async function setRoundPaused(roundId: string, paused: boolean): Promise<ActionResult> {
  const id = idSchema.safeParse(roundId);
  return id.success ? command(id.data, paused) : invalid;
}
