"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

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

/**
 * Sound and vibration for "you're up next" / "you're on court" while the page is open. Off until the
 * player turns it on: browsers only allow audio after a tap, and this shouldn't spring on people in a
 * quiet gym. Vibration is `navigator.vibrate`, which Android browsers implement and iPhone Safari never
 * has; on an iPhone the phone-notification path (see use-push) is the only way to get a buzz.
 */
export function useAlerts() {
  const enabled = useSyncExternalStore(subscribe, read, () => false);
  const ctx = useRef<AudioContext | null>(null);
  // Server render and first client render agree (false); the real answer arrives right after hydration.
  const canVibrate = useSyncExternalStore(
    noopSubscribe,
    () => "vibrate" in navigator,
    () => false,
  );

  const audio = useCallback(() => {
    if (!ctx.current) {
      // Safari puts plain Web Audio in the "ambient" category, which the iPhone's silent switch mutes.
      // "playback" (Audio Session API, Safari only) must be set before the context is created. The
      // player turned alerts on themselves, so an alert they asked for is allowed to be heard.
      const session = (navigator as AudioSessionNav).audioSession;
      if (session) session.type = "playback";
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) ctx.current = new Ctor();
    }
    void ctx.current?.resume();
    return ctx.current;
  }, []);

  const beep = useCallback(
    (pattern: number[]) => {
      const c = audio();
      if (!c) return;
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
    },
    [audio],
  );

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
    const unlock = () => void audio();
    window.addEventListener("pointerdown", unlock, { once: true });
    // iOS suspends audio when the page is backgrounded or a call interrupts it; wake it when we're back.
    const onVisible = () => document.visibilityState === "visible" && void ctx.current?.resume();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, audio]);

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
