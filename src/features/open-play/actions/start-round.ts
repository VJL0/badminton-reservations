"use server";

import { idSchema } from "../schemas";
import { startRound as command } from "../server/commands";
import { invalid } from "../server/errors";
import type { ActionResult } from "./result";

export async function startRound(roundId: string): Promise<ActionResult> {
  const id = idSchema.safeParse(roundId);
  return id.success ? command(id.data) : invalid;
}
