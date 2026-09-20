"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { listen } from "../client/realtime";
import { type Snapshot, snapshotSchema } from "../schemas";

const POLL_MS = 30_000; // safety net only; Broadcast is the primary signal
const COALESCE_MS = 150; // a burst of broadcasts (several joins at once) becomes one refetch

/**
 * Holds the authoritative snapshot. The broadcast message carries no state, only the revision it announces:
 * a revision we already hold is ignored, a newer one (and every reconnect / tab wake) refetches the snapshot.
 * `offsetMs` = server clock − local clock, so timers are correct even when the phone's clock is wrong.
 */
export function useSessionRealtime(initial: Snapshot) {
  const [snapshot, setSnapshot] = useState(initial);
  const [offsetMs, setOffsetMs] = useState(0);
  const [connected, setConnected] = useState(false);
  const latest = useRef(0);
  const revision = useRef(initial.revision);
  const code = initial.session.code;
  const sessionId = initial.session.id;

  // The newest revision on screen: a broadcast for anything at or below it has nothing new to say.
  useEffect(() => {
    revision.current = snapshot.revision;
  }, [snapshot.revision]);

  const refresh = useCallback(async () => {
    const ticket = ++latest.current;
    const sentAt = Date.now();
    const { data, error } = await getBrowserSupabase().rpc("get_snapshot", { p_code: code });
    if (error || !data || ticket !== latest.current) return; // failed, or a newer request already answered
    const parsed = snapshotSchema.safeParse(data);
    if (!parsed.success) {
      console.error("[snapshot] the database returned an unexpected shape", parsed.error.issues[0]);
      return;
    }
    setSnapshot(parsed.data);
    setOffsetMs(Date.parse(parsed.data.server_now) - (sentAt + Date.now()) / 2);
  }, [code]);

  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | undefined;
    const scheduleRefresh = () => {
      clearTimeout(pending);
      pending = setTimeout(() => void refresh(), COALESCE_MS);
    };
    scheduleRefresh(); // the server-rendered snapshot may already be a moment old

    const stop = listen(
      `session:${sessionId}`,
      "session_changed",
      (payload) => {
        const announced = Number((payload as { revision?: unknown } | null)?.revision);
        if (Number.isFinite(announced) && announced <= revision.current) return; // already seen: a duplicate or a late message
        scheduleRefresh();
      },
      (status) => {
        setConnected(status === "SUBSCRIBED");
        if (status === "SUBSCRIBED") void refresh(); // catch anything missed while offline
      },
    );

    const onVisible = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    const poll = setInterval(onVisible, POLL_MS);

    return () => {
      clearTimeout(pending);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
      stop();
    };
  }, [sessionId, refresh]);

  return { snapshot, offsetMs, connected, refresh };
}
