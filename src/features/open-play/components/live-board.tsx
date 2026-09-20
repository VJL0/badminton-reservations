"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState, useTransition } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { createClient } from "@/lib/supabase/client";
import { finishRound } from "../actions/finish-round";
import { joinQueue } from "../actions/join-queue";
import { leaveQueue } from "../actions/leave-queue";
import { setRoundPaused } from "../actions/pause-round";
import { removePlayer } from "../actions/remove-player";
import type { ActionResult } from "../actions/rpc";
import { startRound } from "../actions/start-round";
import { makeEta } from "../eta";
import { useAlerts } from "../hooks/use-alerts";
import { useNow } from "../hooks/use-now";
import { useSessionRealtime } from "../hooks/use-session-realtime";
import { useWakeLock } from "../hooks/use-wake-lock";
import { isUpNext, type Snapshot } from "../types";
import { AlertSettings } from "./alert-settings";
import { CourtCard } from "./court-card";
import { PanelBoundary } from "./panel-boundary";
import { PlayerStatus } from "./player-status";
import { QrButton } from "./qr-button";
import { Queue } from "./queue";
import { SessionSettings } from "./session-settings";
import { ShuttleIcon } from "./shuttle-icon";
import { StaffMenu } from "./staff-menu";

const NOTICES = {
  "not-found": "That session code wasn't found, so we've taken you to the session that's running now.",
  ended: "That session has ended. This is the session running now.",
} as const;

export function LiveBoard({ initial, notice }: { initial: Snapshot; notice?: keyof typeof NOTICES }) {
  const router = useRouter();
  const { snapshot, offsetMs, connected, refresh } = useSessionRealtime(initial);
  const now = useNow(initial.server_now, offsetMs);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const { session, me, courts, queue } = snapshot;
  const eta = makeEta(snapshot, now);

  // Timers run on the server clock. When one runs out, whoever is looking reports it and the database checks
  // the clock, ignoring early or duplicate reports, so a small random delay just spreads the requests:
  //  - a full court's start countdown -> start the game
  //  - a running game past its time (when the session ends games automatically) -> end it, and the next game
  //    steps on and starts. A server timer does the same every 30s for rooms where no phone is open.
  const reported = useRef(new Map<string, number>());
  const due = courts
    .flatMap((c) => {
      const r = c.round;
      if (!r) return [];
      if (r.status === "FILLING" && r.start_at && Date.parse(r.start_at) <= now) return [`start:${r.id}`];
      if (r.status === "ACTIVE" && r.ends_at && !r.paused_at && session.auto_finish && Date.parse(r.ends_at) <= now)
        return [`finish:${r.id}`];
      return [];
    })
    .join(",");
  useEffect(() => {
    if (!due) return;
    const report = () => {
      for (const key of due.split(",")) {
        if (Date.now() - (reported.current.get(key) ?? 0) < 4500) continue; // already reported: give it a moment
        reported.current.set(key, Date.now());
        const [kind, id] = key.split(":");
        if (!id) continue;
        void (kind === "start" ? startRound(id) : finishRound(id)).then(() => refresh());
      }
    };
    const first = setTimeout(report, Math.random() * 1000); // spread simultaneous reports across phones
    const retry = setInterval(report, 5000); // a report that failed is sent again
    return () => {
      clearTimeout(first);
      clearInterval(retry);
    };
  }, [due, refresh]);

  // The URL carried a one-time notice; drop it so a refresh doesn't repeat it.
  useEffect(() => {
    if (notice) window.history.replaceState(null, "", window.location.pathname);
  }, [notice]);

  // The session ended while a player was watching: if another one is live, move them there after a moment
  // (long enough to read the message). Officers stay put; they may want to look at the final board.
  const [moving, setMoving] = useState<string | null>(null);
  const ended = session.status === "ENDED";
  const isPlayer = me.role === null;
  useEffect(() => {
    if (!ended || !isPlayer) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    void createClient()
      .rpc("get_active_session_code")
      .then(({ data }) => {
        if (cancelled || typeof data !== "string" || data === session.code) return;
        setMoving(data);
        timer = setTimeout(() => router.replace(`/play/${data}?notice=ended`), 4000);
      });
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ended, isPlayer, session.code, router]);

  // Whatever the Home Screen icon was counting, the player has now seen it.
  useEffect(() => {
    const clear = () => document.visibilityState === "visible" && void navigator.clearAppBadge?.().catch(() => {});
    clear();
    document.addEventListener("visibilitychange", clear);
    return () => document.removeEventListener("visibilitychange", clear);
  }, []);

  // Keep the screen on while you're queued or on a court, and nudge you when your turn comes.
  useWakeLock(me.state !== "IDLE" && session.status === "ACTIVE");
  const alerts = useAlerts();
  const last = useRef<{ playing: boolean; next: boolean } | null>(null);
  const playing = me.state === "PLAYING";
  const upNext = isUpNext(me);
  // An Effect Event always sees the latest `alerts` and `pending` without making the effect re-run for them:
  // the effect below should fire when *your turn changes*, not on every render.
  const onTurnChange = useEffectEvent((playingNow: boolean, upNextNow: boolean) => {
    const prev = last.current;
    last.current = { playing: playingNow, next: upNextNow };
    if (!prev || pending) return; // first look, or the change is the player's own tap
    if (playingNow && !prev.playing) alerts.notify("court");
    else if (upNextNow && !prev.next) alerts.notify("next");
  });
  useEffect(() => {
    onTurnChange(playing, upNext);
  }, [playing, upNext]);

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
        <div className="flex min-w-0 items-center gap-2.5 lg:gap-3.5">
          <span className="hidden text-ink lg:flex">
            <ShuttleIcon size={44} />
          </span>
          <span className="flex text-ink lg:hidden">
            <ShuttleIcon size={32} />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <p className="break-words font-display text-2xl font-extrabold uppercase leading-[0.9] tracking-[0.03em] lg:text-[32px]">
              {session.name}
            </p>
            <p className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-2 lg:text-xs lg:tracking-[0.14em]">
              Open play · {session.code}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3 lg:gap-6">
          {session.status === "ACTIVE" && <QrButton code={session.code} size={36} />}
          <span className="flex items-center gap-2 font-mono text-[11px] font-medium tracking-[0.14em] text-mat lg:text-xs">
            <i className={`live-dot size-2 rounded-full ${connected ? "bg-mat" : "bg-cork"}`} />
            <span className="max-[379px]:sr-only">{connected ? "LIVE" : "RECONNECTING"}</span>
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

      {(notice || moving) && (
        <Alert role="status">
          <AlertDescription>
            {moving ? "This session has ended. Taking you to the session running now…" : notice ? NOTICES[notice] : null}
          </AlertDescription>
        </Alert>
      )}
      <PlayerStatus
        snapshot={snapshot}
        now={now}
        eta={eta}
        busy={pending}
        onJoin={() => run(() => joinQueue(session.id))}
        onLeave={() => run(() => leaveQueue(session.id))}
        onStart={(roundId) => run(() => startRound(roundId))}
        onFinish={(roundId) => run(() => finishRound(roundId))}
        onTogglePause={(roundId, pause) => run(() => setRoundPaused(roundId, pause))}
      />
      {session.status === "ACTIVE" && (
        <PanelBoundary label="Alerts">
          <AlertSettings sound={alerts.enabled} onSound={alerts.set} onTry={alerts.preview} canVibrate={alerts.canVibrate} />
        </PanelBoundary>
      )}
      {me.role === "ADMIN" && session.status === "ACTIVE" && (
        <PanelBoundary label="Session settings">
          <SessionSettings snapshot={snapshot} busy={pending} run={run} />
        </PanelBoundary>
      )}
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
              onTogglePause={(roundId, pause) => run(() => setRoundPaused(roundId, pause))}
              onRemove={(playerId) => run(() => removePlayer(session.id, playerId))}
            />
          ))}
        </div>
      </section>

      {session.status === "ACTIVE" && (
        <PanelBoundary label="The queue">
          <Queue queue={queue} me={me} eta={eta} onRemove={(playerId) => run(() => removePlayer(session.id, playerId))} />
        </PanelBoundary>
      )}
    </main>
  );
}
