"use client";

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * Shown while the phone has no connection. A tap made now does not wait and replay later: the app has no
 * offline queue, so a stale command can never run after the board has moved on. It fails at once, with a message,
 * and the person taps again when they are back. (Reading the connection this way is the browser's own signal,
 * so it can miss a network that is connected but going nowhere; the board's RECONNECTING light covers that.)
 */
export function OfflineBanner() {
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true, // the server, and the first render, assume online
  );
  if (online) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-50 bg-signal px-4 pt-[calc(env(safe-area-inset-top,0px)+8px)] pb-2 text-center text-sm font-semibold text-white"
    >
      You&apos;re offline. Taps won&apos;t go through until you&apos;re back online.
    </div>
  );
}
