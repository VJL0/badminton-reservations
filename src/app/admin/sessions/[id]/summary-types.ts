export type Flag = "no_games" | "long_wait";

export type PlayerStat = {
  player_id: string;
  name: string;
  games: number;
  playing_s: number;
  waiting_s: number;
  longest_wait_s: number | null;
  first_seen: string;
  last_seen: string;
  present_s: number;
  flags: Flag[];
};

export type CourtStat = { court_number: number; removed: boolean; format: string; busy_s: number; window_s: number; idle_backed_s: number };

export type Summary = {
  session: {
    id: string;
    code: string;
    name: string;
    status: "ACTIVE" | "ENDED";
    started_at: string;
    ended_at: string | null;
    game_duration_seconds: number;
    auto_requeue_on_finish: boolean;
    auto_start: boolean;
    start_delay_seconds: number;
    courts: number;
    wait_tracked: boolean;
  };
  totals: {
    players: number;
    games: number;
    played: number;
    no_games: number;
    median_wait_s: number | null;
    longest_wait_s: number | null;
    peak_queue: number;
    peak_present: number;
    flagged: number;
  };
  court_use: { busy_s: number; window_s: number; idle_backed_s: number };
  courts: CourtStat[];
  players: PlayerStat[];
  games: { id: string; court_number: number; started_at: string; ended_at: string | null; players: string[] }[];
};
