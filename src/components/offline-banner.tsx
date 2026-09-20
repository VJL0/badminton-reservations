"use client";

import { useOffline } from "next/offline";

/**
 * Shown while the phone has no connection. With `experimental.useOffline` on, taps that need the server
 * (join, leave, pause...) are held and sent by Next.js when the connection returns, so say so.
 */
export function OfflineBanner() {
  const offline = useOffline();
  if (!offline) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-50 bg-signal px-4 pt-[calc(env(safe-area-inset-top,0px)+8px)] pb-2 text-center text-sm font-semibold text-white"
    >
      You&apos;re offline. Your taps will go through when you&apos;re back.
    </div>
  );
}
