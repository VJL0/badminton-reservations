import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ctaClass } from "../styles";
import { formatRemaining } from "./court-timer";
import { openCourts, remainingMs } from "../eta";
import { isUpNext, type Snapshot } from "../types";

type Props = {
  snapshot: Snapshot;
  now: number;
  eta: (index: number) => string | null;
  busy: boolean;
  onJoin: () => void;
  onLeave: () => void;
  onStart: (roundId: string) => void;
  onFinish: (roundId: string) => void;
  onTogglePause: (roundId: string, pause: boolean) => void;
};

type Action = { label: string; run: () => void; kind: "join" | "leave" | "urgent" | "plain" };

/**
 * The one line everybody scans for: where am I? Its buttons live in a bar fixed to the bottom of the
 * phone (the easy thumb reach) with the action you're most likely to need for your current state.
 */
export function PlayerStatus({ snapshot, now, eta, busy, onJoin, onLeave, onStart, onFinish, onTogglePause }: Props) {
  const { me, courts, session, queue } = snapshot;
  const myCourt = courts.find((c) => c.round && c.round.id === me.round_id);
  const ended = session.status === "ENDED";
  const autoStart = session.auto_start;

  let tone: "play" | "next" | "wait" | "idle" = "idle";
  let title = "You're not in the queue";
  let sub = "";
  let actions: Action[] = [{ label: "Join queue", run: onJoin, kind: "join" }];

  if (ended) {
    title = "This session has ended";
    sub = "Thanks for playing.";
    actions = [];
  } else if (me.state === "PLAYING" && myCourt?.round) {
    tone = "play";
    title = `You're on court ${myCourt.court_number}`;
    const r = myCourt.round;
    if (r.status === "FILLING") {
      const need = myCourt.capacity - r.players.length;
      sub = need === 0
        ? r.start_at ? "The court is full. The game starts automatically." : "The court is full. Start when you're ready."
        : `Waiting for ${need} more. ${autoStart ? "The game starts when the court is full." : "Press Start when you're ready."}`;
      actions = [{ label: "Leave court", run: onLeave, kind: "leave" }];
      if (r.players.length >= 2 && (!autoStart || r.start_at)) {
        actions.unshift({ label: r.start_at ? "Start now" : "Start game", run: () => onStart(r.id), kind: "plain" });
      }
    } else {
      const rem = remainingMs(r, now);
      const paused = !!r.paused_at;
      const timeUp = !paused && rem <= 0;
      sub = paused
        ? "The game is paused. Your time is on hold."
        : timeUp
          ? session.auto_finish
            ? "Time's up. The game is ending and the next players are stepping on."
            : "Time's up. End the game so the next players can step on."
          : `${formatRemaining(rem)} left. Done early? Use End game on your court.`;
      sub += " Leaving lets the game carry on without you.";
      actions = [{ label: "Leave game", run: onLeave, kind: "leave" }];
      actions.unshift(
        timeUp
          ? { label: "End game", run: () => onFinish(r.id), kind: "urgent" }
          : { label: paused ? "Play" : "Pause", run: () => onTogglePause(r.id, !paused), kind: "plain" },
      );
    }
  } else if (me.state === "QUEUED") {
    const pos = me.queue_position ?? 1;
    const wanted = courts.find((c) => c.id === me.preferred_court_id);
    const next = isUpNext(me);
    tone = next ? "next" : "wait";
    title = next ? "You're up next" : `You're #${pos} in line`;
    sub = wanted
      ? `#${pos} in line for court ${wanted.court_number}. You get it when it frees up.`
      : `${next ? `#${pos} in line. Stay close to the courts. ` : ""}${eta(pos - 1) ?? "Waiting for a court"}. You move up as games end.`;
    actions = [{ label: "Leave queue", run: onLeave, kind: "leave" }];
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
        tone === "next" && "bg-ink text-white ring-4 ring-cork",
        tone === "wait" && "bg-cork text-cork-ink",
        tone === "idle" && "bg-[#d3dcd6] text-ink",
      )}
    >
      <div className="flex min-w-0 flex-col gap-1.5 lg:gap-2">
        {me.display_name && <p className="font-mono text-[11px] uppercase tracking-[0.14em] lg:hidden">{me.display_name}</p>}
        <h1 className="font-display text-[46px] font-extrabold uppercase leading-[0.9] text-balance lg:text-[54px]">{title}</h1>
        <p className="max-w-[760px] text-[15px] leading-relaxed lg:text-[17px]">{sub}</p>
      </div>
      {actions.length > 0 && (
        <div className="flex gap-3 max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-10 max-lg:border-t max-lg:border-ink/15 max-lg:bg-chalk max-lg:px-4 max-lg:pb-[calc(env(safe-area-inset-bottom,0px)+16px)] max-lg:pt-3 max-lg:[@media(max-height:500px)]:pb-[calc(env(safe-area-inset-bottom,0px)+8px)] max-lg:[@media(max-height:500px)]:pt-2">
          {actions.map((a) => (
            <Button
              key={a.label}
              variant={a.kind === "leave" || a.kind === "plain" ? "outline" : "default"}
              className={cn(
                ctaClass,
                "min-w-0 flex-1 lg:w-auto lg:flex-none max-lg:[@media(max-height:500px)]:h-11 max-lg:[@media(max-height:500px)]:text-xl",
                actions.length > 1 && "px-2 text-lg min-[360px]:px-3 min-[360px]:text-xl lg:px-8 lg:text-[26px]",
                a.kind === "join" && "hover:bg-primary/85",
                a.kind === "urgent" && "border-transparent bg-signal text-white hover:bg-signal/90",
                (a.kind === "leave" || a.kind === "plain") &&
                  "border-ink bg-transparent text-ink hover:bg-black/10 hover:text-ink lg:border-current lg:text-current lg:hover:text-current",
              )}
              disabled={busy}
              onClick={a.run}
            >
              {a.label}
            </Button>
          ))}
        </div>
      )}
    </section>
  );
}
