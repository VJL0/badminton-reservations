"use server";

import { idSchema } from "../schemas";
import { finishRound as command } from "../server/commands";
import { invalid } from "../server/errors";
import type { ActionResult } from "./result";

export async function finishRound(roundId: string): Promise<ActionResult> {
  const id = idSchema.safeParse(roundId);
  return id.success ? command(id.data) : invalid;
}
