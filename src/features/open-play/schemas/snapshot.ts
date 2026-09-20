import { z } from "zod";
import { count, guid, timestamp } from "./shared";
import { staffRoleSchema } from "./staff";

const courtPlayer = z.object({ participant_id: guid, name: z.string(), slot: z.number().int() });

const round = z.object({
  id: guid,
  status: z.enum(["FILLING", "ACTIVE"]),
  started_at: timestamp.nullable(),
  ends_at: timestamp.nullable(),
  /** A full court is counting down to an automatic start at this time. */
  start_at: timestamp.nullable(),
  /** The game is paused: its clock stopped at this time. */
  paused_at: timestamp.nullable(),
  players: z.array(courtPlayer),
});

const court = z.object({
  id: guid,
  court_number: z.number().int(),
  /** Players per side of the net; capacity is their sum (1v1 = 2, 2v2 = 4, 1v2 = 3 ...). */
  side_a_size: z.number().int(),
  side_b_size: z.number().int(),
  capacity: z.number().int(),
  round: round.nullable(),
});

const queueEntry = z.object({
  participant_id: guid,
  name: z.string(),
  position: z.number().int(),
  court_number: z.number().int().nullable(),
});

/** api.get_snapshot(): everything a phone needs to draw the board, in one document. */
export const snapshotSchema = z.object({
  /** Bumped once per state change. A broadcast for a revision at or below this one has already been seen. */
  revision: count,
  server_now: timestamp,
  session: z.object({
    id: guid,
    code: z.string(),
    name: z.string(),
    status: z.enum(["ACTIVE", "ENDED"]),
    game_duration_seconds: z.number().int(),
    auto_requeue_on_finish: z.boolean(),
    auto_start: z.boolean(),
    /** Games end by themselves when their time is up. */
    auto_finish: z.boolean(),
    start_delay_seconds: z.number().int(),
  }),
  me: z.object({
    /** The login. */
    id: guid,
    /** Who this login is in this session; null until they have joined it. */
    participant_id: guid.nullable(),
    display_name: z.string().nullable(),
    state: z.enum(["IDLE", "QUEUED", "PLAYING"]),
    round_id: guid.nullable(),
    preferred_court_id: guid.nullable(),
    queue_position: z.number().int().nullable(),
    role: staffRoleSchema.nullable(),
  }),
  courts: z.array(court),
  queue: z.array(queueEntry),
});

export type Snapshot = z.infer<typeof snapshotSchema>;
export type Court = Snapshot["courts"][number];
