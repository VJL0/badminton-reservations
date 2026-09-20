"use client";

import { useCallback, useEffect, useState } from "react";
import { deletePushSubscription, savePushSubscription, sendTestNotification } from "../actions/push";

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

/** unsupported: this browser can't. needs-install: iPhone Safari only allows it from the Home Screen. */
export type PushState = "hidden" | "unsupported" | "needs-install" | "denied" | "off" | "on";

function keyBytes(base64Url: string) {
  const b64 = (base64Url + "=".repeat((4 - (base64Url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function sameKey(current: ArrayBuffer | null, expected: string) {
  if (!current) return false;
  const a = new Uint8Array(current);
  const b = keyBytes(expected);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function usePush() {
  const [state, setState] = useState<PushState>("hidden");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!PUBLIC_KEY) return; // push isn't configured on this server: say nothing
    let cancelled = false;
    const set = (next: PushState) => {
      if (!cancelled) setState(next);
    };
    void (async () => {
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const standalone = window.matchMedia("(display-mode: standalone)").matches;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        return set(ios && !standalone ? "needs-install" : "unsupported");
      }
      if (Notification.permission === "denied") return set("denied");
      try {
        const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
        let sub = await reg.pushManager.getSubscription();
        if (sub && Notification.permission === "granted") {
          // A subscription is tied to the server key it was made with. If the keys were rotated, the old
          // one can never receive anything again: replace it (allowed without a tap, permission is already granted).
          if (!sameKey(sub.options.applicationServerKey, PUBLIC_KEY!)) {
            await sub.unsubscribe();
            sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(PUBLIC_KEY!) });
          }
          set("on");
          void savePushSubscription(sub.toJSON()); // re-claim it for whoever is signed in now
        } else set("off");
      } catch {
        set("unsupported");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission(); // must be called from the tap
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(PUBLIC_KEY!) }));
      const res = await savePushSubscription(sub.toJSON());
      if (!res.ok) {
        await sub.unsubscribe();
        setError(res.error);
        return;
      }
      setState("on");
    } catch {
      setError("Couldn't turn notifications on. Try again.");
    } finally {
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await deletePushSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
    } finally {
      setBusy(false);
    }
  }, []);

  const test = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await sendTestNotification();
      if (!res.ok) setError(res.error);
    } finally {
      setBusy(false);
    }
  }, []);

  return { state, busy, error, enable, disable, test };
}
