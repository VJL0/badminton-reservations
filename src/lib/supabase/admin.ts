import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import type { Database } from "./database.types";

/**
 * Admin client (secret key): bypasses RLS and runs as the `service_role`, which is how staff-only
 * database functions recognize a privileged caller. Only use after `hasStaffSession()` has verified
 * the caller. The key must never be NEXT_PUBLIC_*.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("SUPABASE_SECRET_KEY is not set. See .env.example.");
  return createClient<Database>(env.SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
