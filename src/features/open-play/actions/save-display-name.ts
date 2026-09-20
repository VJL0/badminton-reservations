"use server";

import { firstIssue, nameSchema } from "../schemas";
import { setDisplayName } from "../server/commands";
import type { ActionResult } from "./result";

// Sign-in itself happens in the browser (Supabase rate-limits per client IP, and every Server
// Action would otherwise share Vercel's IP). This only stores the validated display name.
export async function saveDisplayName(name: string): Promise<ActionResult> {
  const parsed = nameSchema.safeParse(name);
  return parsed.success ? setDisplayName(parsed.data) : { ok: false, error: firstIssue(parsed.error) };
}
