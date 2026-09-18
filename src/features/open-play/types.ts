type PlayerState = "IDLE" | "QUEUED" | "PLAYING";
type RoundStatus = "FILLING" | "ACTIVE";

type CourtPlayer = { player_id: string; name: string; slot: number };

export type Court = {
  id: string;
  court_number: number;
  status: "OPEN" | "PAUSED";
  round: null | {
    id: string;
    status: RoundStatus;
    started_at: string | null;
    ends_at: string | null;
    players: CourtPlayer[];
  };
};

type QueueEntry = { player_id: string; name: string; position: number };

export type Snapshot = {
  server_now: string;
  session: {
    id: string;
    code: string;
    name: string;
    status: "ACTIVE" | "ENDED";
    game_duration_seconds: number;
  };
  me: {
    id: string;
    display_name: string | null;
    state: PlayerState;
    round_id: string | null;
    queue_position: number | null;
    role: "ADMIN" | "OPERATOR" | null;
  };
  courts: Court[];
  queue: QueueEntry[];
};

export const PLAYERS_PER_COURT = 4;
