import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Court, Snapshot } from "../types";
import { ConfirmButton } from "./confirm-button";
import { TimerPlate } from "./court-timer";
import { PlayerSlot } from "./player-slot";

type Props = {
  court: Court;
  me: Snapshot["me"];
  now: number;
  durationSeconds: number;
  busy: boolean;
  onFinish: (roundId: string) => void;
  onTogglePause: (court: Court) => void;
  onRemove: (playerId: string) => void;
};

const CHIP: Record<string, string> = {
  play: "bg-mat text-white",
  up: "bg-signal text-white",
  fill: "bg-cork text-cork-ink",
  open: "border-sage bg-transparent text-sage",
};

export function CourtCard({ court, me, now, durationSeconds, busy, onFinish, onTogglePause, onRemove }: Props) {
  const round = court.round;
  const players = round?.players ?? [];
  const isStaff = me.role !== null;
  const mine = round !== null && me.round_id === round.id;
  const active = round?.status === "ACTIVE" && !!round.ends_at;
  const timeUp = active && Date.parse(round!.ends_at!) - now <= 0;
  const canEnd = active && (isStaff || mine);
  const bySlot = new Map(players.map((p) => [p.slot, p]));

  const paused = court.status === "PAUSED";
  const chip = timeUp ? ["up", "Time's up"] : active ? ["play", "In play"] : paused && !round ? ["open", "Paused"] : players.length ? ["fill", "Filling"] : ["open", "Open"];
  const meta = active
    ? `${Math.round(durationSeconds / 60)}-minute game`
    : paused && !round
      ? "Paused. Nobody is placed here."
      : players.length
        ? "Timer starts when the 4th player arrives"
        : "Empty. The next person in line steps on.";

  // Slots 1–2 are one side of the net, 3–4 the other.
  const slot = (n: number) => {
    const p = bySlot.get(n);
    return (
      <PlayerSlot
        key={n}
        name={p?.name}
        isMe={p?.player_id === me.id}
        onRemove={isStaff && p && round?.status === "FILLING" ? () => onRemove(p.player_id) : undefined}
      />
    );
  };

  return (
    <section aria-label={`Court ${court.court_number}`} className="mx-auto flex w-full max-w-[520px] flex-col gap-3 lg:max-w-[324px] lg:gap-[18px]">
      <header className="flex items-end justify-between">
        <div className="flex items-end gap-2 lg:gap-3">
          <span className="font-display text-[40px] font-extrabold leading-[0.8] text-line lg:text-[104px]">{court.court_number}</span>
          <span className="pb-0 font-mono text-[11px] uppercase tracking-[0.14em] text-sage lg:pb-1.5 lg:text-xs">Court</span>
        </div>
        <Badge className={cn("h-7 px-3 font-mono text-xs uppercase tracking-[0.12em]", CHIP[chip[0]])}>{chip[1]}</Badge>
      </header>

      <div className={cn("mat", mine && "mine")}>
        <div className="court">
          {["side-a", "side-b", "long-a", "long-b", "short-a", "short-b", "cen-a", "cen-b"].map((c) => (
            <div key={c} className={cn("ln", c)} />
          ))}
          <div className="net" />
          <div className="post post-a" />
          <div className="post post-b" />
          <div className="tokgrid">{[1, 2, 3, 4].map(slot)}</div>
          <TimerPlate court={court} now={now} durationSeconds={durationSeconds} />
        </div>
      </div>

      <div className="flex min-h-0 flex-col gap-3 lg:min-h-[64px]">
        <p className="text-sm leading-snug text-sage">{meta}</p>
        {(canEnd || isStaff) && (
          <div className="flex gap-2">
            {canEnd && round && (
              <ConfirmButton
                label={timeUp ? "End game · bring on the next four" : "End game early"}
                tone={timeUp ? "urgent" : "hall"}
                className="flex-1"
                disabled={busy}
                onConfirm={() => onFinish(round.id)}
              />
            )}
            {isStaff && (
              <ConfirmButton
                label={paused ? "Resume" : "Pause"}
                confirmLabel="Confirm"
                tone="hall"
                disabled={busy}
                onConfirm={() => onTogglePause(court)}
              />
            )}
          </div>
        )}
      </div>
    </section>
  );
}
