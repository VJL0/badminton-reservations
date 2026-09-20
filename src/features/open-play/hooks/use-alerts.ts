"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

const KEY = "open-play-alerts";

let memory = false; // used when storage is blocked (private window): still works for this visit
const listeners = new Set<() => void>();

function read() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return memory;
  }
}
function write(on: boolean) {
  memory = on;
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* not persisted */
  }
  for (const l of listeners) l();
}
const noopSubscribe = () => () => {};

function subscribe(l: () => void) {
  listeners.add(l);
  window.addEventListener("storage", l);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", l);
  };
}

type Kind = "next" | "court";

type AudioSessionNav = Navigator & { audioSession?: { type: string } };

// One audio context for the whole tab. iPhone Safari allows only a few, and navigating between pages remounts the
// hook, so a context per mount eventually fails with "InvalidStateError: Failed to start the audio device".
let shared: AudioContext | null = null;

/**
 * The tab's audio context, created on first use, or null when the device can't play audio right now
 * (a call, another app holding the speaker, no Web Audio). Alerts are a nicety: this never throws.
 */
function audioContext(): AudioContext | null {
  try {
    if (!shared || shared.state === "closed") {
      // Safari puts plain Web Audio in the "ambient" category, which the iPhone's silent switch mutes.
      // "playback" (Audio Session API, Safari only) must be set before the context is created. The
      // player turned alerts on themselves, so an alert they asked for is allowed to be heard.
      const session = (navigator as AudioSessionNav).audioSession;
      if (session) session.type = "playback";
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      shared = Ctor ? new Ctor() : null;
    }
    // iOS suspends the context (or reports "interrupted") when the page is backgrounded or a call comes in.
    // resume() rejects while the device is still busy; the next tap or return to the page tries again.
    if (shared && shared.state !== "running") shared.resume().catch(() => {});
    return shared;
  } catch {
    shared = null;
    return null;
  }
}

/**
 * Sound and vibration for "you're up next" / "you're on court" while the page is open. Off until the
 * player turns it on: browsers only allow audio after a tap, and this shouldn't spring on people in a
 * quiet gym. Vibration is `navigator.vibrate`, which Android browsers implement and iPhone Safari never
 * has; on an iPhone the phone-notification path (see use-push) is the only way to get a buzz.
 */
export function useAlerts() {
  const enabled = useSyncExternalStore(subscribe, read, () => false);
  // Server render and first client render agree (false); the real answer arrives right after hydration.
  const canVibrate = useSyncExternalStore(
    noopSubscribe,
    () => "vibrate" in navigator,
    () => false,
  );

  const beep = useCallback((pattern: number[]) => {
    const c = audioContext();
    if (!c) return;
    try {
      let t = c.currentTime;
      for (const freq of pattern) {
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        osc.connect(gain).connect(c.destination);
        osc.start(t);
        osc.stop(t + 0.24);
        t += 0.28;
      }
    } catch {
      // The context broke under us (device lost): drop it so the next alert builds a fresh one.
      shared = null;
    }
  }, []);

  const play = useCallback(
    (kind: Kind) => {
      beep(kind === "court" ? [660, 880, 1100] : [660, 880]);
      navigator.vibrate?.(kind === "court" ? [250, 120, 250, 120, 250] : [200, 100, 200]);
    },
    [beep],
  );

  useEffect(() => {
    if (!enabled) return;
    // A reloaded page has a locked audio context until the next tap.
    const unlock = () => void audioContext();
    window.addEventListener("pointerdown", unlock, { once: true });
    // Wake it when we're back: from the background, or restored from Safari's back/forward cache.
    // Only resume an existing context here: building one needs a tap, and this isn't one.
    const onVisible = () => {
      if (document.visibilityState === "visible" && shared && shared.state !== "running") shared.resume().catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
    };
  }, [enabled]);

  const set = useCallback(
    (on: boolean) => {
      write(on);
      if (on) play("next"); // runs inside the tap, which is what unlocks audio; also previews the sound
    },
    [play],
  );

  return {
    enabled,
    set,
    /** Play the real "it's your court" alert now (for the "try it" button). Always runs inside a tap. */
    preview: useCallback(() => play("court"), [play]),
    notify: useCallback((kind: Kind) => enabled && play(kind), [enabled, play]),
    canVibrate,
  };
}
