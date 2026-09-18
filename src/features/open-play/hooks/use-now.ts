"use client";

import { useEffect, useState } from "react";

/**
 * Server-adjusted "now", re-derived from the clock every second. Never a
 * decrementing counter: after a background-tab throttle the next tick (or the
 * visibilitychange below) is immediately correct.
 */
export function useNow(initialServerNow: string, offsetMs: number) {
  const [now, setNow] = useState(() => Date.parse(initialServerNow));

  useEffect(() => {
    const tick = () => setNow(Date.now() + offsetMs);
    const id = setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [offsetMs]);

  return now;
}
