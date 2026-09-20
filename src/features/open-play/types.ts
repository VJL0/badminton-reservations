import type { Court, Snapshot } from "./schemas";

// The shapes come from the Zod schemas (which also validate them at runtime); this file keeps the board's small helpers.
export type { Court, Snapshot };

/** The queue is drawn in rows of four, whatever the courts hold. */
export const QUEUE_ROW = 4;

export const formatLabel = (c: Pick<Court, "side_a_size" | "side_b_size">) => `${c.side_a_size}v${c.side_b_size}`;

/** In the first row of the queue: the next court to free up is yours. */
export const isUpNext = (me: Pick<Snapshot["me"], "state" | "queue_position">) =>
  me.state === "QUEUED" && (me.queue_position ?? Infinity) <= QUEUE_ROW;
