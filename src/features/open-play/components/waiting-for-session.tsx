"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { listen } from "../client/realtime";
import { activeSessionCodeSchema } from "../schemas";

const FALLBACK_MS = 30_000;

/**
 * Sits on the "nothing is running" page and opens the queue the moment a session starts, so a player who arrived
 * early doesn't have to scan or refresh.
 *
 * By now this browser has a login (the name form made an anonymous one), which the private lobby channel needs.
 * A message on the channel only means "the live session changed": the answer always comes from asking the
 * database. The same question is asked when the channel (re)connects and when the phone wakes or comes back online.
 * There is no polling interval; a slow check runs only while the channel is not connected, as a last resort after
 * Realtime has been failing for a while.
 */
export function WaitingForSession() {
  const router = useRouter();
  const [subscribed, setSubscribed] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  const arrived = useRef(false);

  // Ask the database whether a session is live; if so, go there.
  const check = useCallback(async () => {
    if (arrived.current || inFlight.current || document.visibilityState !== "visible") return;
    inFlight.current = true;
    try {
      const { data } = await getBrowserSupabase().rpc("get_active_session_code");
      const code = activeSessionCodeSchema.safeParse(data);
      if (code.success && code.data && !arrived.current) {
        arrived.current = true;
        router.replace(`/play/${code.data}`);
      }
    } catch {
      // Offline or a blip: the next signal asks again.
    } finally {
      inFlight.current = false;
    }
  }, [router]);

  // 1. Listen for the lobby announcing a change, and ask right away in case we missed one.
  useEffect(() => {
    void check();
    return listen(
      "open-play:lobby",
      "active_session_changed",
      () => void check(),
      (status) => {
        setSubscribed(status === "SUBSCRIBED");
        setFailed(status === "CHANNEL_ERROR" || status === "TIMED_OUT");
        if (status === "SUBSCRIBED") void check();
      },
    );
  }, [check]);

  // 2. Coming back to the page is a reason to ask again.
  useEffect(() => {
    const again = () => void check();
    document.addEventListener("visibilitychange", again);
    window.addEventListener("online", again);
    window.addEventListener("pageshow", again);
    return () => {
      document.removeEventListener("visibilitychange", again);
      window.removeEventListener("online", again);
      window.removeEventListener("pageshow", again);
    };
  }, [check]);

  // 3. Last resort: only while the channel is not connected.
  useEffect(() => {
    if (subscribed) return;
    const timer = setInterval(() => void check(), FALLBACK_MS);
    return () => clearInterval(timer);
  }, [subscribed, check]);

  return (
    <div className="flex flex-col gap-4">
      <p
        role="status"
        data-live-updates={subscribed ? "on" : "off"}
        className="flex items-center gap-2 font-mono text-xs font-medium tracking-caps text-mat uppercase"
      >
        <i className="live-dot size-2 rounded-full bg-mat" />
        Waiting for open play to start
      </p>
      {failed && (
        <p role="alert" className="text-sm text-muted-foreground">
          Live updates are reconnecting. We&apos;ll keep checking every so often.
        </p>
      )}
    </div>
  );
}
