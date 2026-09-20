import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { serverEnv } from "@/lib/env.server";
import type { Database } from "./database.types";

/**
 * Client holding the secret key: it bypasses RLS, but it only ever calls the few `api` functions granted to
 * `service_role` (the push worker's queue, and granting staff), never tables. Server code only, after the
 * caller has been verified where the action needs it. The key must never be NEXT_PUBLIC_*.
 */
export function createPrivilegedSupabaseClient() {
  const key = serverEnv.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("SUPABASE_SECRET_KEY is not set. See .env.example.");
  return createClient<Database, "api">(env.SUPABASE_URL, key, {
    db: { schema: "api" },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Is the secret key configured? Features that need it stay off without it. */
export const privilegedClientConfigured = () => !!serverEnv.SUPABASE_SECRET_KEY;
