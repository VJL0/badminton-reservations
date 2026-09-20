import "server-only";
import type { createClient } from "@/lib/supabase/server";

/** The code of the live session, or null when nothing is running. Only one session is live at a time. */
export async function getActiveSessionCode(supabase: Awaited<ReturnType<typeof createClient>>): Promise<string | null> {
  const { data, error } = await supabase.rpc("get_active_session_code");
  if (error) throw new Error(`get_active_session_code failed: ${error.message}`);
  return data;
}
