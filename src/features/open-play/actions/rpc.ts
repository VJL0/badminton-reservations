import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

export type ActionResult = { ok: true } | { ok: false; error: string };

const MESSAGES: Record<string, string> = {
  not_authenticated: "Please enter your name first.",
  profile_required: "Please enter your name first.",
  not_staff: "Only officers can do that.",
  not_allowed: "Only the players on this court or an officer can start or end the game.",
  game_in_progress: "A game is running on that court. Try again once it ends.",
  session_ended: "This session has ended.",
  last_court: "A session needs at least one court.",
  not_enough_players: "A game needs at least two players.",
  invalid_duration: "Games run between 1 and 180 minutes.",
  invalid_delay: "The countdown is between 0 and 300 seconds.",
  invalid_court_format: "Each side needs between one and four players.",
  too_many_courts: "A session can have at most 30 courts.",
  court_not_found: "Court not found.",
  session_not_found: "Session not found.",
  round_not_active: "That game isn't running.",
  invalid_name: "Enter a name between 1 and 40 characters.",
  queue_full: "The queue is full right now. Try again in a few minutes.",
  invalid_subscription: "This browser can't receive notifications.",
  too_fast: "Slow down a second, then try again.",
};

export const invalid: ActionResult = { ok: false, error: "Invalid request." };

// Server Actions are public endpoints: authorization lives in the database
// functions, which read the caller's JWT. This only forwards the call.
type Fns = Database["public"]["Functions"];
/** Only functions clients may call: the `_internal` ones are locked away in the database. */
type RpcName = Exclude<keyof Fns, `_${string}`>;

// The generated types make a wrong function name or argument name a compile error, not a runtime one.
export async function callRpc<F extends RpcName>(fn: F, args: Fns[F]["Args"]): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) {
    const friendly = MESSAGES[error.message];
    // Known failures are user errors; anything else is ours to see in the logs.
    if (!friendly) console.error(`[rpc] ${fn} failed: ${error.code ?? ""} ${error.message}`);
    return { ok: false, error: friendly ?? "Something went wrong. Try again." };
  }
  return { ok: true };
}
