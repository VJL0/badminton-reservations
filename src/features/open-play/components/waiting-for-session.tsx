"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

const POLL_MS = 5000;

/** Re-renders the page when a session starts. Polls while visible, and on wake or reconnect. */
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
          router.refresh();
        }
      } catch {
        // The next check retries.
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
