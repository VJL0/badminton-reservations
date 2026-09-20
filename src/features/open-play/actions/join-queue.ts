"use server";

import { idSchema } from "../schemas";
import { joinQueue as command } from "../server/commands";
import { invalid } from "../server/errors";
import type { ActionResult } from "./result";

/** Queue for the session, or for one specific court. Already queued? This just switches courts. */
export async function joinQueue(sessionId: string, courtId: string | null = null): Promise<ActionResult> {
  const s = idSchema.safeParse(sessionId);
  const c = courtId === null ? null : idSchema.safeParse(courtId);
  if (!s.success || (c && !c.success)) return invalid;
  return command(s.data, c?.data ?? null);
}
