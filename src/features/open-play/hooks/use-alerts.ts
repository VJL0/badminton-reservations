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
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  window.addEventListener("storage", l);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", l);
  };
}

type Kind = "next" | "court";

/**
 * Sound and vibration for "you're up next" / "you're on court". Off until the player turns it on:
 * browsers only allow audio after a tap, and iPhones can't vibrate a web page at all, so this is
 * an opt-in extra rather than something to spring on people in a quiet gym.
 */
export function useAlerts() {
  const enabled = useSyncExternalStore(subscribe, read, () => false);
  const ctx = useRef<AudioContext | null>(null);
  const canVibrate = typeof navigator !== "undefined" && "vibrate" in navigator;

  const audio = useCallback(() => {
    if (!ctx.current) {
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
    return () => window.removeEventListener("pointerdown", unlock);
  }, [enabled, audio]);

  const set = useCallback(
    (on: boolean) => {
      write(on);
      if (on) play("next"); // runs inside the tap, which is what unlocks audio; also previews the sound
    },
    [play],
  );

  return { enabled, set, notify: useCallback((kind: Kind) => enabled && play(kind), [enabled, play]), canVibrate };
}
