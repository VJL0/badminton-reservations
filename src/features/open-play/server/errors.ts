import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";
import type { ActionResult } from "../actions/result";

export type { ActionResult };

export const invalid: ActionResult = { ok: false, error: "Invalid request." };
export const denied: ActionResult = { ok: false, error: "Only admins can do that." };

/** What a person is told for each failure the database raises on purpose. Anything else is ours to look at. */
const MESSAGES: Record<string, string> = {
  not_authenticated: "Please enter your name first.",
  profile_required: "Please enter your name first.",
  not_staff: "Only officers can do that.",
  not_allowed: "Only the players on this court or an officer can start or end the game.",
  game_in_progress: "A game is running on that court. Try again once it ends.",
  session_ended: "This session has ended.",
  session_active: "End the session before deleting it.",
  already_active: "A session is already live. End it before starting another.",
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

/** A failed call to an `api` function. `code` is what the function raised (`not_staff`, `session_ended`...). */
export class DatabaseError extends Error {
  readonly fn: string;
  readonly code: string;
  constructor(fn: string, code: string, detail: string) {
    super(`${fn} failed: ${detail}`);
    this.name = "DatabaseError";
    this.fn = fn;
    this.code = code;
  }
  /** Something a person can act on, when the database refused on purpose. */
  get friendly(): string | undefined {
    return MESSAGES[this.code];
  }
}

export const translateDatabaseError = (fn: string, error: PostgrestError) =>
  new DatabaseError(fn, error.message, `${error.code ?? ""} ${error.message}`.trim());

export const isDatabaseError = (e: unknown, code?: string): e is DatabaseError =>
  e instanceof DatabaseError && (code === undefined || e.code === code);
