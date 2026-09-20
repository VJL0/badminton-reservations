import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { remainingMs } from "../eta";
import { type Court, formatLabel, type Snapshot } from "../types";
import { ConfirmButton } from "./confirm-button";
import { TimerPlate } from "./court-timer";
import { PlayerSlot } from "./player-slot";

type Props = {
  court: Court;
  me: Snapshot["me"];
  now: number;
  durationSeconds: number;
  autoStart: boolean;
  ended: boolean;
  busy: boolean;
  onQueue: (courtId: string) => void;
  onStart: (roundId: string) => void;
  onFinish: (roundId: string) => void;
  onTogglePause: (roundId: string, pause: boolean) => void;
  onRemove: (playerId: string) => void;
};

const CHIP = {
  play: "bg-mat text-white",
  up: "bg-signal text-white",
  fill: "bg-cork text-cork-ink",
  open: "border-sage bg-transparent text-sage",
} as const satisfies Record<string, string>;
type ChipTone = keyof typeof CHIP;

export function CourtCard({
  court,
  me,
  now,
  durationSeconds,
  autoStart,
  ended,
  busy,
  onQueue,
  onStart,
  onFinish,
  onTogglePause,
  onRemove,
}: Props) {
  const round = court.round;
  const players = round?.players ?? [];
  const isStaff = me.role !== null;
  const mine = round !== null && me.round_id === round.id;
  const running = round?.status === "ACTIVE" && round.ends_at ? round : null; // a game with a clock
  const active = running !== null;
  const paused = !!running?.paused_at;
  const filling = round?.status === "FILLING";
  const timeUp = running !== null && !paused && remainingMs(running, now) <= 0;
  const canControl = active && (isStaff || mine);
  const full = players.length >= court.capacity;
  const countingDown = filling && !!round?.start_at;
  // A game can start early (or, with auto-start off, at all) once two are on court.
  const canStart = filling && players.length >= 2 && (isStaff || mine);
  // Room to step straight on: open court, no game running, a free place.
  const hasRoom = round?.status !== "ACTIVE" && !full;
  const bySlot = new Map(players.map((p) => [p.slot, p]));

  const chip: [ChipTone, string] = ended
    ? ["open", "Closed"]
    : timeUp
      ? ["up", "Time's up"]
      : paused
        ? ["open", "Paused"]
        : active
          ? ["play", "In play"]
          : players.length
            ? ["fill", "Filling"]
            : ["open", "Open"];
  const meta = ended
    ? "This session has ended."
    : active
      ? paused
        ? "Game paused. The clock is stopped."
        : `${Math.round(durationSeconds / 60)}-minute game${players.length < court.capacity ? ` · ${players.length} of ${court.capacity} on court` : ""}`
      : countingDown
        ? "Court is full. The game starts automatically."
        : full
          ? "Court is full. Waiting for someone on it to start."
          : players.length
            ? autoStart
              ? `Timer starts when court is full (${court.capacity - players.length} more)`
              : "Waiting to start. Someone on court presses Start."
            : "Empty. The next person in line steps on.";

  let pick: null | { label: string; disabled: boolean } = null;
  if (!ended && me.state !== "PLAYING") {
    if (me.preferred_court_id === court.id) pick = { label: "You're waiting for this court", disabled: true };
    else if (me.state === "QUEUED")
      pick = {
        label: `Switch to court ${court.court_number}`,
        disabled: false,
      };
    else
      pick = {
        label: `${hasRoom ? "Join" : "Queue for"} court ${court.court_number}`,
        disabled: false,
      };
  }

  // Slots 1..a are one side of the net, the rest the other.
  const slot = (n: number) => {
    const p = bySlot.get(n);
    return (
      <PlayerSlot
        key={n}
        name={p?.name}
        isMe={p?.participant_id === me.participant_id}
        onRemove={isStaff && p && filling ? () => onRemove(p.participant_id) : undefined}
      />
    );
  };
  const side = (from: number, size: number) => (
    <div className={cn("tokside", size > 3 ? "dense4" : size > 2 && "dense")}>{Array.from({ length: size }, (_, i) => slot(from + i))}</div>
  );

  return (
    <section
      aria-label={`Court ${court.court_number}`}
      className="mx-auto flex w-full max-w-130 min-w-0 flex-col gap-3 lg:max-w-81 lg:gap-4.5"
    >
      <header className="flex items-end justify-between">
        <div className="flex items-end gap-2 lg:gap-3">
          <span className="font-display text-[2.5rem] leading-[0.8] font-extrabold text-line lg:text-[6.5rem]">{court.court_number}</span>
          <span className="flex flex-col gap-0.5 pb-0 font-mono text-caption tracking-caps text-sage uppercase lg:pb-1.5 lg:text-xs">
            Court
            <span className="text-line">{formatLabel(court)}</span>
          </span>
        </div>
        <Badge className={cn("h-7 px-3 font-mono text-xs tracking-label uppercase", CHIP[chip[0]])}>{chip[1]}</Badge>
      </header>

      <div className={cn("mat", mine && "mine")}>
        <div className="court">
          {["side-a", "side-b", "long-a", "long-b", "short-a", "short-b", "cen-a", "cen-b"].map((c) => (
            <div key={c} className={cn("ln", c)} />
          ))}
          <div className="net" />
          <div className="post post-a" />
          <div className="post post-b" />
          <div className="tokgrid">
            {side(1, court.side_a_size)}
            {side(court.side_a_size + 1, court.side_b_size)}
          </div>
          <TimerPlate court={court} now={now} durationSeconds={durationSeconds} ended={ended} />
        </div>
      </div>

      <div className="flex min-h-0 flex-col gap-3 lg:min-h-16">
        <p className="text-sm leading-snug text-sage">{meta}</p>
        {players.length > 0 && (
          // On the narrowest phones the tokens can only show a few letters, so spell the names out.
          <p className="text-sm leading-snug text-line xs:hidden">{players.map((p) => p.name).join(", ")}</p>
        )}
        {pick && (
          <Button
            className="h-12 rounded-2xl bg-signal text-button font-semibold text-white hover:bg-signal/90"
            disabled={busy || pick.disabled}
            onClick={() => onQueue(court.id)}
          >
            {pick.label}
          </Button>
        )}
        {canStart && round && (
          <Button
            className="h-12 rounded-2xl bg-cork text-button font-semibold text-cork-ink hover:bg-cork/90"
            disabled={busy}
            onClick={() => onStart(round.id)}
          >
            {countingDown ? "Start now" : `Start game (${players.length} on court)`}
          </Button>
        )}
        {canControl && round && (
          <div className="flex gap-2">
            <ConfirmButton
              label={timeUp ? "End game (time's up)" : "End game early"}
              tone={timeUp ? "urgent" : "hall"}
              className="h-auto min-h-12 min-w-0 flex-1 py-2 leading-tight whitespace-normal"
              disabled={busy}
              onConfirm={() => onFinish(round.id)}
            />
            <Button
              variant="outline"
              className="h-12 shrink-0 rounded-2xl border-line/60 bg-transparent px-5 text-button font-semibold text-line hover:bg-line/10 hover:text-line"
              disabled={busy}
              onClick={() => onTogglePause(round.id, !paused)}
            >
              {paused ? "Play" : "Pause"}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
