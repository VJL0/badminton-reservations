import { cn } from "@/lib/utils";
import type { Court } from "../types";
import { PLAYERS_PER_COURT } from "../types";

export function formatRemaining(ms: number) {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** The plate on the net. One segment per minute left in the game. */
export function TimerPlate({ court, now, durationSeconds }: { court: Court; now: number; durationSeconds: number }) {
  const round = court.round;
  const n = round?.players.length ?? 0;
  const active = round?.status === "ACTIVE" && !!round.ends_at;
  const remaining = active ? Date.parse(round!.ends_at!) - now : 0;
  const timeUp = active && remaining <= 0;
  const segments = Math.ceil(durationSeconds / 60);
  const lit = active ? Math.min(segments, Math.ceil(Math.max(0, remaining) / 60_000)) : 0;

  const cls = timeUp ? "up" : active ? "live" : "wait";
  const value = active ? formatRemaining(remaining) : court.status === "PAUSED" && !round ? "PAUSED" : n ? `${n}/${PLAYERS_PER_COURT}` : "OPEN";
  const label = timeUp ? "TIME'S UP" : active ? "REMAINING" : n ? `WAITING FOR ${PLAYERS_PER_COURT - n}` : "NEXT IN LINE";

  return (
    <div className={cn("plate", cls)} role={active ? "timer" : undefined} aria-live="off">
      <div className="digits">{value}</div>
      {active && (
        <div className="segs" aria-hidden>
          {Array.from({ length: segments }, (_, i) => (
            <i key={i} className={cn("seg", i < lit ? (lit <= 2 ? "hot" : "on") : "off")} />
          ))}
        </div>
      )}
      <div className="plabel">{label}</div>
    </div>
  );
}
