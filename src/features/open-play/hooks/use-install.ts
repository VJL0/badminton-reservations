"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Chromium's install prompt event; it is not in TypeScript's DOM types. */
type InstallPromptEvent = Event & { prompt: () => Promise<unknown> };

/** hidden: already installed, or this browser can't install. ios: no prompt exists, show Safari's steps. prompt: the browser's own install dialog. */
export type InstallState = "hidden" | "ios" | "prompt";

// Chromium fires beforeinstallprompt once, early in the page load, often before any component mounts.
// So it is captured here, when this module loads, and handed to whoever asks later.
let deferredPrompt: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => {
  for (const l of listeners) l();
};

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // keep the browser's mini-infobar away; we show our own button
    deferredPrompt = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notify();
  });
}

/** Hands over the captured prompt and forgets it: a browser install prompt can only be shown once. */
function takePrompt() {
  const event = deferredPrompt;
  deferredPrompt = null;
  notify();
  return event;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
// iPadOS 13+ reports itself as a Mac; a Mac with a touch screen is an iPad.
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function getState(): InstallState {
  if (isStandalone()) return "hidden";
  if (isIOS()) return "ios";
  return deferredPrompt ? "prompt" : "hidden";
}

/** How this visitor can put the app on their Home Screen, if at all. */
export function useInstall() {
  const state = useSyncExternalStore(subscribe, getState, () => "hidden" as const);
  const install = useCallback(async () => {
    await takePrompt()
      ?.prompt()
      .catch(() => {});
  }, []);
  return { state, install };
}
