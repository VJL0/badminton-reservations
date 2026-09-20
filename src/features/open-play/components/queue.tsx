import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { QUEUE_ROW, type Snapshot } from "../types";

type Props = {
  queue: Snapshot["queue"];
  me: Snapshot["me"];
  eta: (batch: number) => string | null;
  onRemove: (playerId: string) => void;
};

/** The queue in rows of four: each row is the next game. */
export function Queue({ queue, me, eta, onRemove }: Props) {
  const batches = Array.from({ length: Math.ceil(queue.length / QUEUE_ROW) }, (_, b) => queue.slice(b * QUEUE_ROW, (b + 1) * QUEUE_ROW));

  return (
    <section aria-label="Waiting queue" className="flex flex-col gap-4 lg:gap-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex items-end gap-3 lg:gap-[18px]">
          <h2 className="font-display text-[52px] font-extrabold uppercase leading-[0.82] lg:text-[68px]">Waiting</h2>
          <span className="font-display text-[52px] font-bold leading-[0.82] text-mat lg:text-[68px]">{queue.length}</span>
        </div>
        <p className="font-mono text-xs uppercase tracking-[0.12em] text-ink-2">First in, first on · estimates assume full-length games</p>
      </div>

      {queue.length === 0 && (
        <p className="rounded-3xl border-2 border-dashed border-ink/25 px-6 py-6 text-lg text-[#3b4c45]">
          Nobody&apos;s waiting. Join and you&apos;ll step straight onto a court.
        </p>
      )}

      {batches.map((batch, b) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows of four are positional; a row has no identity of its own
        <div key={b} className="grid gap-2 lg:grid-cols-[210px_minmax(0,1fr)] lg:items-center lg:gap-6">
          <div className="flex items-baseline justify-between gap-3 lg:flex-col lg:items-start lg:gap-1.5">
            <h3 className="shrink-0 whitespace-nowrap font-display text-[26px] font-extrabold uppercase leading-[0.9] tracking-[0.03em] lg:text-[34px]">
              {b === 0 ? "Next up" : "Then"}
            </h3>
            <p className="font-mono text-[11px] leading-snug tracking-[0.06em] text-[#3b4c45] max-lg:text-right lg:text-xs">
              {eta(b * QUEUE_ROW)}
            </p>
          </div>
          <ol
            className={cn(
              "grid grid-cols-1 gap-0.5 overflow-hidden rounded-[18px] border-2 min-[360px]:grid-cols-2 lg:grid-cols-4 lg:rounded-3xl",
              b === 0 ? "border-ink bg-ink" : "border-ink/15 bg-ink/15",
            )}
          >
            {Array.from({ length: QUEUE_ROW }, (_, k) => {
              const q = batch[k];
              const isMe = q?.player_id === me.id;
              return (
                <li
                  // biome-ignore lint/suspicious/noArrayIndexKey: slot k of the row; empty slots have no id
                  key={k}
                  className={cn(
                    "flex h-[58px] items-center gap-2.5 px-3.5 lg:h-[72px] lg:gap-3.5 lg:px-[18px]",
                    !q ? "bg-chalk text-[#5c6d66]" : isMe ? "bg-cork text-cork-ink" : "bg-[#f5f8f5]",
                  )}
                >
                  <span
                    className={cn(
                      "min-w-[26px] font-display text-[30px] font-bold leading-none lg:min-w-[34px] lg:text-[38px]",
                      isMe ? "text-cork-ink/80" : "text-ink-2",
                    )}
                  >
                    {b * QUEUE_ROW + k + 1}
                  </span>
                  <span className={cn("min-w-0 flex-1 truncate text-base lg:text-lg", q ? "font-semibold" : "font-medium")}>
                    {q?.name ?? "Open spot"}
                  </span>
                  {q?.court_number && (
                    <span className="shrink-0 rounded-full bg-ink/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em]">
                      Court {q.court_number}
                    </span>
                  )}
                  {q && me.role && !isMe && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-ink-2 hover:bg-signal/15 hover:text-signal"
                      onClick={() => onRemove(q.player_id)}
                      aria-label={`Remove ${q.name}`}
                    >
                      <HugeiconsIcon icon={Cancel01Icon} />
                    </Button>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </section>
  );
}
