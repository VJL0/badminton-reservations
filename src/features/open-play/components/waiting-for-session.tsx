"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

const POLL_MS = 5000;

/**
 * Sits on the "nothing is running" page and opens the queue the moment a session starts, so a player who
 * arrived early doesn't have to scan or refresh. Checks every few seconds while the page is showing, and
 * right away when the phone wakes up or comes back online.
 */
export function WaitingForSession() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    let stopped = false;
    let inFlight = false;

    async function check() {
      if (stopped || inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        const { data } = await supabase.rpc("get_active_session_code");
        if (!stopped && typeof data === "string") {
          stopped = true;
          router.replace(`/play/${data}`);
        }
      } catch {
        // Offline or a blip: the next check tries again.
      } finally {
        inFlight = false;
      }
    }

    const timer = setInterval(check, POLL_MS);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("online", check);
    window.addEventListener("pageshow", check);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("online", check);
      window.removeEventListener("pageshow", check);
    };
  }, [router]);

  return (
    <p role="status" className="flex items-center gap-2 font-mono text-xs font-medium tracking-caps text-mat uppercase">
      <i className="live-dot size-2 rounded-full bg-mat" />
      Waiting for open play to start
    </p>
  );
}
