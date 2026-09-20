"use client";

import { useEffect } from "react";

/**
 * Keeps the screen on while `active`, so a timer or "you're up" notice is never stale on a locked
 * phone. The browser drops the lock whenever the tab is hidden, so it is asked for again on return.
 * Silently does nothing where unsupported or refused (low battery, permissions policy).
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        const next = await navigator.wakeLock.request("screen");
        if (cancelled) void next.release();
        else lock = next;
      } catch {
        /* refused: the screen just times out as usual */
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release();
    };
  }, [active]);
}
