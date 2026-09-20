import { createBrowserClient } from "@supabase/ssr";
import { env } from "@/lib/env";
import type { Database } from "./database.types";

let browserClient: ReturnType<typeof create> | undefined;

// Every call goes through the `api` schema: the tables behind it are not exposed to the Data API at all.
function create() {
  return createBrowserClient<Database, "api">(env.SUPABASE_URL, env.SUPABASE_KEY, { db: { schema: "api" } });
}

/**
 * The one Supabase client of this browser tab. Auth, the lobby channel, the session channel, push setup and
 * every RPC share it, so they also share one Realtime WebSocket: a stray second client would open a second
 * socket and count twice against the project's connection limit.
 */
export function getBrowserSupabase() {
  browserClient ??= create();
  return browserClient;
}
