import { type Court, type Snapshot } from "./types";

type Round = NonNullable<Court["round"]>;

/** Milliseconds left in a running game. A paused court's clock stands still at the moment it paused. */
export function remainingMs(round: Round, now: number) {
  const at = round.paused_at ? Date.parse(round.paused_at) : now;
  return Date.parse(round.ends_at!) - at;
}

/** Courts a newcomer could be placed on right now, best (fullest) first. */
export function openCourts(courts: Court[]) {
  return courts
    .filter((c) => c.status === "OPEN" && (!c.round || (c.round.status === "FILLING" && c.round.players.length < c.capacity)))
    .sort((a, b) => (b.round?.players.length ?? 0) - (a.round?.players.length ?? 0) || a.court_number - b.court_number);
}

/**
 * "When does the person at queue index i get a court?" Assumes games run their full length.
 * Each running court frees `capacity` places at its end time, and again every game length after that.
 * Paused courts free nothing until they resume, so they are left out.
 */
export function makeEta(snapshot: Snapshot, now: number) {
  const dur = snapshot.session.game_duration_seconds * 1000;
  const places: { t: number; num: number }[] = [];
  for (const c of snapshot.courts) {
    if (c.status !== "OPEN" || c.round?.status !== "ACTIVE" || !c.round.ends_at) continue;
    for (let r = 0; r < 4; r++) {
      for (let k = 0; k < c.capacity; k++) places.push({ t: Date.parse(c.round.ends_at) + r * dur, num: c.court_number });
    }
  }
  places.sort((a, b) => a.t - b.t);
  return (index: number): string | null => {
    const e = places[Math.min(index, places.length - 1)];
    if (!e) return null;
    const wait = e.t - now;
    return wait <= 0
      ? `Court ${e.num} is at time. Waiting on End game.`
      : `Court ${e.num} frees in about ${Math.ceil(wait / 60000)} min`;
  };
}
