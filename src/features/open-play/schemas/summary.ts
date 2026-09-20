import { z } from "zod";
import { count, guid, timestamp } from "./shared";

const seconds = z.number().nonnegative();

const playerStat = z.object({
  participant_id: guid,
  name: z.string(),
  games: count,
  playing_s: seconds,
  waiting_s: seconds,
  longest_wait_s: seconds.nullable(),
  first_seen: timestamp,
  last_seen: timestamp,
  present_s: seconds,
  flags: z.array(z.enum(["no_games", "long_wait"])),
});

/** api.get_session_summary(): waits, court use, per-player numbers and the game history of one session. */
export const summarySchema = z.object({
  session: z.object({
    id: guid,
    code: z.string(),
    name: z.string(),
    status: z.enum(["ACTIVE", "ENDED"]),
    started_at: timestamp,
    ended_at: timestamp.nullable(),
    now: timestamp,
    game_duration_seconds: z.number().int(),
    auto_requeue_on_finish: z.boolean(),
    auto_start: z.boolean(),
    start_delay_seconds: z.number().int(),
    courts: count,
    wait_tracked: z.boolean(),
  }),
  totals: z.object({
    players: count,
    games: count,
    played: count,
    no_games: count,
    median_wait_s: seconds.nullable(),
    longest_wait_s: seconds.nullable(),
    peak_queue: count,
    peak_present: count,
    flagged: count,
  }),
  court_use: z.object({ busy_s: seconds, window_s: seconds, idle_backed_s: seconds }),
  courts: z.array(
    z.object({
      court_number: z.number().int(),
      removed: z.boolean(),
      format: z.string(),
      busy_s: seconds,
      window_s: seconds,
      idle_backed_s: seconds,
    }),
  ),
  players: z.array(playerStat),
  games: z.array(
    z.object({
      id: guid,
      court_number: z.number().int(),
      started_at: timestamp,
      ended_at: timestamp.nullable(),
      players: z.array(z.string()),
    }),
  ),
});

export type Summary = z.infer<typeof summarySchema>;
export type PlayerStat = Summary["players"][number];
