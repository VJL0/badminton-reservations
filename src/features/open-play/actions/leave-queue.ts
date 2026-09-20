"use server";

import { idSchema } from "../schemas";
import { leaveQueue as command } from "../server/commands";
import { invalid } from "../server/errors";
import type { ActionResult } from "./result";

export async function leaveQueue(sessionId: string): Promise<ActionResult> {
  const id = idSchema.safeParse(sessionId);
  return id.success ? command(id.data) : invalid;
}
