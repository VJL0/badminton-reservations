import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ctaClass } from "../styles";
import { formatRemaining } from "./court-timer";
import { openCourts, remainingMs } from "../eta";
import { type Snapshot } from "../types";

type Props = {
  snapshot: Snapshot;
  now: number;
  eta: (batch: number) => string | null;
  busy: boolean;
  onJoin: () => void;
  onLeave: () => void;
};

/** The one line everybody scans for: where am I? Carries the Join / Leave action. */
export function PlayerStatus({ snapshot, now, eta, busy, onJoin, onLeave }: Props) {
  const { me, courts, session, queue } = snapshot;
  const myCourt = courts.find((c) => c.round && c.round.id === me.round_id);
  const ended = session.status === "ENDED";
  const autoStart = session.auto_start;

  let tone: "play" | "wait" | "idle" = "idle";
  let title = "You're not in the queue";
  let sub = "";
  let action: null | { label: string; leave: boolean } = { label: "Join queue", leave: false };

  if (ended) {
    title = "This session has ended";
    sub = "Thanks for playing.";
    action = null;
  } else if (me.state === "PLAYING" && myCourt?.round) {
    tone = "play";
    title = `You're on court ${myCourt.court_number}`;
    const r = myCourt.round;
    if (r.status === "FILLING") {
      const need = myCourt.capacity - r.players.length;
      sub = need === 0
        ? r.start_at ? "The court is full. The game starts automatically." : "The court is full. Someone on it presses Start."
        : `Waiting for ${need} more. ${autoStart ? "The game starts when the court is full." : "Press Start on the court when you're ready."}`;
      action = { label: "Leave court", leave: true };
    } else {
      const rem = remainingMs(r, now);
      const paused = myCourt.status === "PAUSED";
      sub = paused
        ? "This court is paused. Your time is on hold."
        : rem <= 0
          ? "Time's up. Tap End game on your court so the next players can step on."
          : `${formatRemaining(rem)} left. Done early? Tap End game on your court.`;
      sub += " Leaving lets the game carry on without you.";
      action = { label: "Leave game", leave: true };
    }
  } else if (me.state === "QUEUED") {
    tone = "wait";
    const pos = me.queue_position ?? 1;
    const wanted = courts.find((c) => c.id === me.preferred_court_id);
    title = `You're #${pos} in line`;
    sub = wanted
      ? `Waiting for court ${wanted.court_number}. ${wanted.status === "PAUSED" ? "It's paused, so switch courts if you don't want to wait." : "You get it when it frees up."}`
      : `${eta(pos - 1) ?? "Waiting for a court"}. You move up as games end.`;
    action = { label: "Leave queue", leave: true };
  } else {
    const open = queue.length === 0 ? openCourts(courts)[0] : undefined;
    sub = open
      ? `Join and you'll go straight onto Court ${open.court_number} (${open.round?.players.length ?? 0} of ${open.capacity} there). Or pick a court below.`
      : `Join and you'll be #${queue.length + 1} in line. ${eta(queue.length) ?? ""}`.trim();
  }

  return (
    <section
      role="status"
      className={cn(
        "flex flex-col gap-4 rounded-[24px] px-5 py-5 lg:flex-row lg:items-center lg:justify-between lg:gap-8 lg:rounded-[28px] lg:px-[34px] lg:py-[26px]",
        tone === "play" && "bg-mat text-white",
        tone === "wait" && "bg-cork text-cork-ink",
        tone === "idle" && "bg-[#d3dcd6] text-ink",
      )}
    >
      <div className="flex min-w-0 flex-col gap-1.5 lg:gap-2">
        {me.display_name && <p className="font-mono text-[11px] uppercase tracking-[0.14em] lg:hidden">{me.display_name}</p>}
        <h1 className="font-display text-[46px] font-extrabold uppercase leading-[0.9] text-balance lg:text-[54px]">{title}</h1>
        <p className="max-w-[760px] text-[15px] leading-relaxed lg:text-[17px]">{sub}</p>
      </div>
      {action && (
        <div className="max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-10 max-lg:border-t max-lg:border-ink/15 max-lg:bg-chalk max-lg:px-4 max-lg:pb-[calc(env(safe-area-inset-bottom,0px)+16px)] max-lg:pt-3">
          <Button
            variant={action.leave ? "outline" : "default"}
            className={cn(ctaClass, "lg:w-auto", action.leave ? "border-ink bg-transparent text-ink hover:bg-black/10 hover:text-ink lg:border-current lg:text-current lg:hover:text-current" : "hover:bg-primary/85")}
            disabled={busy}
            onClick={action.leave ? onLeave : onJoin}
          >
            {action.label}
          </Button>
        </div>
      )}
    </section>
  );
}
