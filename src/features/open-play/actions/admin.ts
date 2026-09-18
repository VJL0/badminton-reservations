"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createSessionSchema, idSchema } from "../schemas";
import { callRpc, invalid, type ActionResult } from "./rpc";

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/admin/login");
}

export async function createSession(input: {
  name: string;
  courts: number;
  minutes: number;
  autoRequeue: boolean;
}): Promise<ActionResult> {
  const p = createSessionSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const res = await callRpc("create_session", {
    p_name: p.data.name,
    p_court_count: p.data.courts,
    p_game_duration_seconds: p.data.minutes * 60,
    p_auto_requeue: p.data.autoRequeue,
  });
  revalidatePath("/admin");
  return res;
}

export async function endSession(sessionId: string): Promise<ActionResult> {
  const id = idSchema.safeParse(sessionId);
  if (!id.success) return invalid;
  const res = await callRpc("end_session", { p_session_id: id.data });
  revalidatePath("/admin");
  return res;
}
