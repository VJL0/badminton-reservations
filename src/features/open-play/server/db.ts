import "server-only";
import type { Database } from "@/lib/supabase/database.types";
import type { createClient } from "@/lib/supabase/server";
import { translateDatabaseError } from "./errors";

type Fns = Database["api"]["Functions"];
export type RpcName = keyof Fns;
export type Supabase = Awaited<ReturnType<typeof createClient>>;

const SLOW_MS = 250;

/**
 * Every call the server makes to the database goes through here. Slow or failing calls leave one structured log
 * line, so p95s and error rates can be read from the hosting logs (the browser's own calls show up in Supabase's
 * API logs). The generated types make a wrong function or argument name a compile error.
 */
export async function rpc<F extends RpcName>(supabase: Supabase, fn: F, args?: Fns[F]["Args"]): Promise<Fns[F]["Returns"]> {
  const started = performance.now();
  const { data, error } = await supabase.rpc(fn, args as never);
  const ms = Math.round(performance.now() - started);
  if (error) {
    const failure = translateDatabaseError(fn, error);
    // A refusal the database makes on purpose (not_staff, session_ended...) is normal traffic, not an error to page anyone for.
    if (!failure.friendly)
      console.error(JSON.stringify({ level: "error", event: "rpc_failed", fn, ms, code: error.code, message: error.message }));
    throw failure;
  }
  if (ms >= SLOW_MS) console.warn(JSON.stringify({ level: "warn", event: "slow_rpc", fn, ms }));
  return data as Fns[F]["Returns"];
}
