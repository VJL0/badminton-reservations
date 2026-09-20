"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { setCourtPaused } from "../actions/court-status";
import { finishRound } from "../actions/finish-round";
import { joinQueue } from "../actions/join-queue";
import { leaveQueue } from "../actions/leave-queue";
import { removePlayer } from "../actions/remove-player";
import type { ActionResult } from "../actions/rpc";
import { startRound } from "../actions/start-round";
import { makeEta } from "../eta";
import { useNow } from "../hooks/use-now";
import { useSessionRealtime } from "../hooks/use-session-realtime";
import type { Court, Snapshot } from "../types";
import { CourtCard } from "./court-card";
import { StaffMenu } from "./staff-menu";
import { QrButton } from "./qr-button";
import { PlayerStatus } from "./player-status";
import { Queue } from "./queue";
import { SessionSettings } from "./session-settings";
import { ShuttleIcon } from "./shuttle-icon";

export function LiveBoard({ initial }: { initial: Snapshot }) {
  const { snapshot, offsetMs, connected, refresh } = useSessionRealtime(initial);
  const now = useNow(initial.server_now, offsetMs);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const { session, me, courts, queue } = snapshot;
  const eta = makeEta(snapshot, now);

  // Auto-start: when a full court's countdown runs out, whoever is looking reports it. The database checks
  // the clock and ignores early or duplicate reports, so a small random delay just spreads the requests.
  const reported = useRef(new Map<string, number>());
  const dueRounds = courts
    .filter((c) => c.status === "OPEN" && c.round?.status === "FILLING" && c.round.start_at && Date.parse(c.round.start_at) <= now)
    .map((c) => c.round!.id)
    .join(",");
  useEffect(() => {
    const timers = dueRounds
      .split(",")
      .filter(Boolean)
      .filter((id) => Date.now() - (reported.current.get(id) ?? 0) > 5000) // retry a failed report every 5s
      .map((id) =>
        setTimeout(() => {
          reported.current.set(id, Date.now());
          void startRound(id).then(() => refresh());
        }, Math.random() * 1000),
      );
    return () => timers.forEach(clearTimeout);
  }, [dueRounds, now, refresh]);

  function run(action: () => Promise<ActionResult>) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) setError(res.error);
      await refresh();
    });
  }

  return (
    <main className="mx-auto flex w-full max-w-[1360px] flex-col gap-5 px-4 pb-32 pt-5 lg:gap-7 lg:px-14 lg:pb-16 lg:pt-10">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5 lg:gap-3.5">
          <span className="hidden text-ink lg:flex"><ShuttleIcon size={44} /></span>
          <span className="flex text-ink lg:hidden"><ShuttleIcon size={32} /></span>
          <div className="flex flex-col gap-1">
            <p className="font-display text-2xl font-extrabold uppercase leading-[0.9] tracking-[0.03em] lg:text-[32px]">{session.name}</p>
            <p className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-2 lg:text-xs lg:tracking-[0.14em]">Open play · {session.code}</p>
          </div>
        </div>
        <div className="flex items-center gap-4 lg:gap-6">
          {session.status === "ACTIVE" && <QrButton code={session.code} size={36} />}
          <span className="flex items-center gap-2 font-mono text-[11px] font-medium tracking-[0.14em] text-mat lg:text-xs">
            <i className={`live-dot size-2 rounded-full ${connected ? "bg-mat" : "bg-cork"}`} />
            {connected ? "LIVE" : "RECONNECTING"}
          </span>
          {me.role ? (
            <StaffMenu name={me.display_name} role={me.role} />
          ) : (
            <div className="hidden flex-col items-end gap-0.5 lg:flex">
              <span className="text-base font-bold">{me.display_name}</span>
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-2">player</span>
            </div>
          )}
        </div>
      </header>

      <PlayerStatus
        snapshot={snapshot}
        now={now}
        eta={eta}
        busy={pending}
        onJoin={() => run(() => joinQueue(session.id))}
        onLeave={() => run(() => leaveQueue(session.id))}
      />
      {me.role === "ADMIN" && session.status === "ACTIVE" && <SessionSettings snapshot={snapshot} busy={pending} run={run} />}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <section className="flex flex-col gap-7 rounded-[28px] bg-hall px-4 pb-8 pt-6 lg:gap-[30px] lg:rounded-[36px] lg:px-10 lg:pb-10 lg:pt-[34px]">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
          <h2 className="font-display text-[28px] font-extrabold uppercase tracking-[0.05em] text-line lg:text-4xl">The courts</h2>
          <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-sage lg:text-xs">
            {Math.round(session.game_duration_seconds / 60)}-minute games · {session.auto_start ? "auto-start" : "manual start"}
          </p>
        </div>
        <div className="grid gap-9 lg:grid-cols-3 lg:gap-6">
          {courts.map((court) => (
            <CourtCard
              key={court.id}
              court={court}
              me={me}
              now={now}
              durationSeconds={session.game_duration_seconds}
              autoStart={session.auto_start}
              ended={session.status === "ENDED"}
              busy={pending}
              onQueue={(courtId) => run(() => joinQueue(session.id, courtId))}
              onStart={(roundId) => run(() => startRound(roundId))}
              onFinish={(roundId) => run(() => finishRound(roundId))}
              onTogglePause={(c: Court) => run(() => setCourtPaused(c.id, c.status === "OPEN"))}
              onRemove={(playerId) => run(() => removePlayer(session.id, playerId))}
            />
          ))}
        </div>
      </section>

      <Queue queue={queue} me={me} eta={eta} onRemove={(playerId) => run(() => removePlayer(session.id, playerId))} />
    </main>
  );
}
