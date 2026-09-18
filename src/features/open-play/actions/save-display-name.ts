"use server";

import { nameSchema } from "../schemas";
import { callRpc, type ActionResult } from "./rpc";

// Sign-in itself happens in the browser (Supabase rate-limits per client IP, and every Server
// Action would otherwise share Vercel's IP). This only stores the validated display name.
export async function saveDisplayName(name: string): Promise<ActionResult> {
  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  return callRpc("set_display_name", { p_name: parsed.data });
}
