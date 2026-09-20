import { z } from "zod";
import { count, timestamp } from "./shared";

/** api.ops_health(): what an admin needs to see before guessing that the database is the bottleneck. */
export const opsHealthSchema = z.object({
  now: timestamp,
  live_sessions: count,
  participants: count,
  anonymous_users: count,
  push: z.object({
    enabled: z.boolean(),
    queued: count,
    /** Age of the oldest notification still waiting for delivery; null when the queue is empty. */
    oldest_age_s: z.number().nullable(),
    delivered_or_dropped: count,
  }),
  timers: z.array(
    z.object({
      name: z.string(),
      schedule: z.string(),
      active: z.boolean(),
      last_run_at: timestamp.nullable(),
      last_status: z.string().nullable(),
      failures_24h: count,
    }),
  ),
  get_snapshot: z.object({ calls: z.number().nullable(), mean_ms: z.number().nullable(), max_ms: z.number().nullable() }).nullable(),
});
export type OpsHealth = z.infer<typeof opsHealthSchema>;
