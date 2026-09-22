import "server-only";

/**
 * Best-effort in-memory fixed-window limiter: no external store, so it resets whenever the
 * serverless instance recycles. Good enough to blunt casual brute-forcing of the staff code
 * without adding infrastructure; not a substitute for a real distributed limiter at scale.
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

const attempts = new Map<string, { count: number; resetAt: number }>();
const SWEEP_EVERY = 100; // amortize eviction instead of scanning on every call
let callsSinceSweep = 0;

/** Drops expired entries so a long-lived process (or a key that changes every request) can't grow this unboundedly. */
function sweep(now: number) {
  if (++callsSinceSweep < SWEEP_EVERY) return;
  callsSinceSweep = 0;
  for (const [key, entry] of attempts) {
    if (entry.resetAt < now) attempts.delete(key);
  }
}

export function checkRateLimit(key: string): boolean {
  const now = Date.now();
  sweep(now);
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (entry.count >= MAX_ATTEMPTS) return false;
  entry.count += 1;
  return true;
}
