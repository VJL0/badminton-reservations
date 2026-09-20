"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Snapshot } from "../types";

const POLL_MS = 30_000; // safety net only; Broadcast is the primary signal
const COALESCE_MS = 150; // a burst of broadcasts (several joins at once) becomes one refetch

/**
 * Holds the authoritative snapshot. The broadcast message carries no state:
 * on `session_changed` (and on reconnect / tab wake) we refetch the snapshot.
 * `offsetMs` = server clock − local clock, so timers are correct even when the
 * phone's clock is wrong.
 */
export function useSessionRealtime(initial: Snapshot) {
  const [snapshot, setSnapshot] = useState(initial);
  const [offsetMs, setOffsetMs] = useState(0);
  const [connected, setConnected] = useState(false);
  const latest = useRef(0);
  const code = initial.session.code;
  const sessionId = initial.session.id;

  const refresh = useCallback(async () => {
    const ticket = ++latest.current;
    const sentAt = Date.now();
    const { data, error } = await createClient().rpc("get_snapshot", {
      p_code: code,
    });
    if (error || !data || ticket !== latest.current) return; // stale response
    const midpoint = (sentAt + Date.now()) / 2;
    setSnapshot(data as Snapshot);
    setOffsetMs(Date.parse((data as Snapshot).server_now) - midpoint);
  }, [code]);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let pending: ReturnType<typeof setTimeout> | undefined;
    const scheduleRefresh = () => {
      clearTimeout(pending);
      pending = setTimeout(() => void refresh(), COALESCE_MS);
    };
    void refresh();

    const channel = supabase.channel(`session:${sessionId}`, {
      config: { private: true },
    });
    channel.on("broadcast", { event: "session_changed" }, scheduleRefresh);
    void supabase.realtime.setAuth().then(() => {
      if (cancelled) return;
      channel.subscribe((status) => {
        setConnected(status === "SUBSCRIBED");
        if (status === "SUBSCRIBED") void refresh(); // catch anything missed while offline
      });
    });

    const onVisible = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    const poll = setInterval(onVisible, POLL_MS);

    return () => {
      cancelled = true;
      clearTimeout(pending);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [sessionId, refresh]);

  return { snapshot, offsetMs, connected, refresh };
}
