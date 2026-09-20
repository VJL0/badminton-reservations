"use server";

import { courtFormatSchema, firstIssue, idSchema, sessionSettingsSchema } from "../schemas";
import * as commands from "../server/commands";
import { invalid } from "../server/errors";
import type { ActionResult } from "./result";

export async function updateSessionSettings(
  sessionId: string,
  input: { minutes: number; autoRequeue: boolean; autoStart: boolean; startDelaySeconds: number; autoFinish: boolean },
): Promise<ActionResult> {
  const id = idSchema.safeParse(sessionId);
  if (!id.success) return invalid;
  const p = sessionSettingsSchema.safeParse(input);
  return p.success ? commands.updateSessionSettings(id.data, p.data) : { ok: false, error: firstIssue(p.error) };
}

export async function addCourt(sessionId: string, sideA: number, sideB: number): Promise<ActionResult> {
  const id = idSchema.safeParse(sessionId);
  const f = courtFormatSchema.safeParse({ sideA, sideB });
  if (!id.success) return invalid;
  return f.success ? commands.addCourt(id.data, f.data.sideA, f.data.sideB) : { ok: false, error: firstIssue(f.error) };
}

export async function deleteCourt(courtId: string): Promise<ActionResult> {
  const id = idSchema.safeParse(courtId);
  return id.success ? commands.deleteCourt(id.data) : invalid;
}

export async function updateCourt(courtId: string, sideA: number, sideB: number): Promise<ActionResult> {
  const id = idSchema.safeParse(courtId);
  const f = courtFormatSchema.safeParse({ sideA, sideB });
  if (!id.success) return invalid;
  return f.success ? commands.updateCourt(id.data, f.data.sideA, f.data.sideB) : { ok: false, error: firstIssue(f.error) };
}
