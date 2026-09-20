import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, requireStaff } from "./auth";
import { rpc } from "./db";
import { type ActionResult, DatabaseError, denied } from "./errors";

// Every state change goes through here. The rules themselves live in the database functions; a command only
// says who may ask (checked here first, and again by the database), forwards the call, and turns the
// database's refusals into something a person can read.

type Run = (supabase: Awaited<ReturnType<typeof createClient>>) => Promise<unknown>;

async function run(step: Run): Promise<ActionResult> {
  try {
    await step(await createClient());
    return { ok: true };
  } catch (e) {
    if (e instanceof DatabaseError) return { ok: false, error: e.friendly ?? "Something went wrong. Try again." };
    throw e;
  }
}

const asStaff = async (step: Run): Promise<ActionResult> =>
  (await requireStaff()) ? run(step) : { ok: false, error: "Only officers can do that." };
const asAdmin = async (step: Run): Promise<ActionResult> => ((await requireAdmin()) ? run(step) : denied);

// ---- players (any signed-in person; the database decides what they may do to *this* game)

export const setDisplayName = (name: string) => run((db) => rpc(db, "set_display_name", { p_name: name }));

export const joinQueue = (sessionId: string, courtId: string | null) =>
  run((db) => rpc(db, "join_queue", { p_session_id: sessionId, p_court_id: courtId ?? undefined }));

export const leaveQueue = (sessionId: string) => run((db) => rpc(db, "leave_queue", { p_session_id: sessionId }));
export const startRound = (roundId: string) => run((db) => rpc(db, "start_round", { p_round_id: roundId }));
export const finishRound = (roundId: string) => run((db) => rpc(db, "finish_round", { p_round_id: roundId }));
export const setRoundPaused = (roundId: string, paused: boolean) =>
  run((db) => rpc(db, paused ? "pause_round" : "resume_round", { p_round_id: roundId }));

export const savePushSubscription = (endpoint: string, p256dh: string, auth: string) =>
  run((db) => rpc(db, "save_push_subscription", { p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth }));
export const deletePushSubscription = (endpoint: string) => run((db) => rpc(db, "delete_push_subscription", { p_endpoint: endpoint }));

// ---- officers

export const removePlayer = (sessionId: string, participantId: string) =>
  asStaff((db) => rpc(db, "remove_player", { p_session_id: sessionId, p_participant_id: participantId }));

// ---- admins

export const createSession = (input: { name: string; courts: number; minutes: number; autoRequeue: boolean }) =>
  asAdmin((db) =>
    rpc(db, "create_session", {
      p_name: input.name,
      p_court_count: input.courts,
      p_game_duration_seconds: input.minutes * 60,
      p_auto_requeue: input.autoRequeue,
    }),
  );
export const endSession = (sessionId: string) => asAdmin((db) => rpc(db, "end_session", { p_session_id: sessionId }));
export const deleteSession = (sessionId: string) => asAdmin((db) => rpc(db, "delete_session", { p_session_id: sessionId }));

export const updateSessionSettings = (
  sessionId: string,
  s: { minutes: number; autoRequeue: boolean; autoStart: boolean; startDelaySeconds: number; autoFinish: boolean },
) =>
  asAdmin((db) =>
    rpc(db, "update_session_settings", {
      p_session_id: sessionId,
      p_game_duration_seconds: s.minutes * 60,
      p_auto_requeue: s.autoRequeue,
      p_auto_start: s.autoStart,
      p_start_delay_seconds: s.startDelaySeconds,
      p_auto_finish: s.autoFinish,
    }),
  );
export const addCourt = (sessionId: string, sideA: number, sideB: number) =>
  asAdmin((db) => rpc(db, "add_court", { p_session_id: sessionId, p_side_a: sideA, p_side_b: sideB }));
export const updateCourt = (courtId: string, sideA: number, sideB: number) =>
  asAdmin((db) => rpc(db, "update_court", { p_court_id: courtId, p_side_a: sideA, p_side_b: sideB }));
export const deleteCourt = (courtId: string) => asAdmin((db) => rpc(db, "delete_court", { p_court_id: courtId }));
