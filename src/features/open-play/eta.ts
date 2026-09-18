import { PLAYERS_PER_COURT, type Court, type Snapshot } from "./types";

/** Courts (paused or not) that a newcomer would be placed on right now, best first. */
export function openCourts(courts: Court[]) {
  return courts
    .filter((c) => c.status === "OPEN" && (!c.round || (c.round.status === "FILLING" && c.round.players.length < PLAYERS_PER_COURT)))
    .sort((a, b) => (b.round?.players.length ?? 0) - (a.round?.players.length ?? 0) || a.court_number - b.court_number);
}

/**
 * "When does batch b of four get a court?" Assumes games run their full length.
 * Each running court frees at ends_at, then every duration after that.
 */
export function makeEta(snapshot: Snapshot, now: number) {
  const dur = snapshot.session.game_duration_seconds * 1000;
  const events: { t: number; num: number }[] = [];
  for (const c of snapshot.courts) {
    if (c.round?.status !== "ACTIVE" || !c.round.ends_at) continue;
    for (let r = 0; r < 4; r++) events.push({ t: Date.parse(c.round.ends_at) + r * dur, num: c.court_number });
  }
  events.sort((a, b) => a.t - b.t);
  return (batch: number): string | null => {
    const e = events[Math.min(batch, events.length - 1)];
    if (!e) return null;
    const wait = e.t - now;
    return wait <= 0
      ? `Court ${e.num} is at time. Waiting on End game.`
      : `Court ${e.num} frees in about ${Math.ceil(wait / 60000)} min`;
  };
}
