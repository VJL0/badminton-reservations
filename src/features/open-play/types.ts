type PlayerState = "IDLE" | "QUEUED" | "PLAYING";
type RoundStatus = "FILLING" | "ACTIVE";

type CourtPlayer = { player_id: string; name: string; slot: number };

export type Court = {
  id: string;
  court_number: number;
  /** Players per side of the net; capacity is their sum (1v1 = 2, 2v2 = 4, 1v2 = 3 ...). */
  side_a_size: number;
  side_b_size: number;
  capacity: number;
  round: null | {
    id: string;
    status: RoundStatus;
    started_at: string | null;
    ends_at: string | null;
    /** A full court is counting down to an automatic start at this time. */
    start_at: string | null;
    /** The game is paused: its clock stopped at this time. */
    paused_at: string | null;
    players: CourtPlayer[];
  };
};

type QueueEntry = { player_id: string; name: string; position: number; court_number: number | null };

export type Snapshot = {
  server_now: string;
  session: {
    id: string;
    code: string;
    name: string;
    status: "ACTIVE" | "ENDED";
    game_duration_seconds: number;
    auto_requeue_on_finish: boolean;
    auto_start: boolean;
    /** Games end by themselves when their time is up. */
    auto_finish: boolean;
    start_delay_seconds: number;
  };
  me: {
    id: string;
    display_name: string | null;
    state: PlayerState;
    round_id: string | null;
    preferred_court_id: string | null;
    queue_position: number | null;
    role: "ADMIN" | "OPERATOR" | null;
  };
  courts: Court[];
  queue: QueueEntry[];
};

/** The queue is drawn in rows of four, whatever the courts hold. */
export const QUEUE_ROW = 4;

export const formatLabel = (c: Pick<Court, "side_a_size" | "side_b_size">) => `${c.side_a_size}v${c.side_b_size}`;

/** In the first row of the queue: the next court to free up is yours. */
export const isUpNext = (me: Pick<Snapshot["me"], "state" | "queue_position">) =>
  me.state === "QUEUED" && (me.queue_position ?? Infinity) <= QUEUE_ROW;
