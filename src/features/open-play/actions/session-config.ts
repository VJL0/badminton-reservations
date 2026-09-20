"use server";

import { courtFormatSchema, idSchema, sessionSettingsSchema } from "../schemas";
import { type ActionResult, callRpc, invalid } from "./rpc";

export async function updateSessionSettings(
  sessionId: string,
  input: {
    minutes: number;
    autoRequeue: boolean;
    autoStart: boolean;
    startDelaySeconds: number;
    autoFinish: boolean;
  },
): Promise<ActionResult> {
  const id = idSchema.safeParse(sessionId);
  if (!id.success) return invalid;
  const p = sessionSettingsSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  return callRpc("update_session_settings", {
    p_session_id: id.data,
    p_game_duration_seconds: p.data.minutes * 60,
    p_auto_requeue: p.data.autoRequeue,
    p_auto_start: p.data.autoStart,
    p_start_delay_seconds: p.data.startDelaySeconds,
    p_auto_finish: p.data.autoFinish,
  });
}

export async function addCourt(sessionId: string, sideA: number, sideB: number): Promise<ActionResult> {
  const id = idSchema.safeParse(sessionId);
  const f = courtFormatSchema.safeParse({ sideA, sideB });
  if (!id.success) return invalid;
  if (!f.success) return { ok: false, error: f.error.issues[0].message };
  return callRpc("add_court", {
    p_session_id: id.data,
    p_side_a: f.data.sideA,
    p_side_b: f.data.sideB,
  });
}

export async function deleteCourt(courtId: string): Promise<ActionResult> {
  const id = idSchema.safeParse(courtId);
  return id.success ? callRpc("delete_court", { p_court_id: id.data }) : invalid;
}

export async function updateCourt(courtId: string, sideA: number, sideB: number): Promise<ActionResult> {
  const id = idSchema.safeParse(courtId);
  const f = courtFormatSchema.safeParse({ sideA, sideB });
  if (!id.success) return invalid;
  if (!f.success) return { ok: false, error: f.error.issues[0].message };
  return callRpc("update_court", {
    p_court_id: id.data,
    p_side_a: f.data.sideA,
    p_side_b: f.data.sideB,
  });
}
