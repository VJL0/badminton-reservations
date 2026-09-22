"use server";

import { refresh } from "next/cache";
import { createSessionSchema, firstIssue, idSchema } from "../schemas";
import type { FormState } from "./form-state";
import { type ActionResult, callStaffOnlyRpc, invalid } from "./rpc";

async function createSession(input: { name: string; courts: number; minutes: number; autoRequeue: boolean }): Promise<ActionResult> {
  const p = createSessionSchema.safeParse(input);
  if (!p.success) return { ok: false, error: firstIssue(p.error) };
  const res = await callStaffOnlyRpc("create_session", {
    p_name: p.data.name,
    p_court_count: p.data.courts,
    p_game_duration_seconds: p.data.minutes * 60,
    p_auto_requeue: p.data.autoRequeue,
  });
  refresh();
  return res;
}

export async function endSession(sessionId: string): Promise<ActionResult> {
  const id = idSchema.safeParse(sessionId);
  if (!id.success) return invalid;
  const res = await callStaffOnlyRpc("end_session", { p_session_id: id.data });
  refresh();
  return res;
}

export async function deleteSession(sessionId: string): Promise<ActionResult> {
  const id = idSchema.safeParse(sessionId);
  if (!id.success) return invalid;
  const res = await callStaffOnlyRpc("delete_session", { p_session_id: id.data });
  refresh();
  return res;
}

/** The "New session" form: works before JavaScript loads, and keeps what was typed if something is wrong. */
export async function createSessionForm(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = {
    name: String(formData.get("name") ?? ""),
    courts: String(formData.get("courts") ?? ""),
    minutes: String(formData.get("minutes") ?? ""),
    autoRequeue: formData.get("autoRequeue") === "on",
  };
  const res = await createSession({
    name: values.name,
    courts: Number(values.courts),
    minutes: Number(values.minutes),
    autoRequeue: values.autoRequeue,
  });
  return res.ok ? { ok: true, message: "Session created." } : { ok: false, error: res.error, values };
}
