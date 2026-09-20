import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import type { Database } from "./database.types";

/**
 * Service-role client: bypasses RLS and can manage auth users. Server Actions only, and only after
 * the caller has been verified as an ADMIN. The key must never be NEXT_PUBLIC_*.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set. See .env.example.");
  return createClient<Database>(env.SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
