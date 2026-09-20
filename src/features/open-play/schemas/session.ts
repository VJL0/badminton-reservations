import { z } from "zod";
import { count, guid, timestamp } from "./shared";

/** api.list_sessions(): the officer console's list, newest first. */
export const sessionListSchema = z.array(
  z.object({
    id: guid,
    code: z.string(),
    name: z.string(),
    status: z.enum(["ACTIVE", "ENDED"]),
    created_at: timestamp,
    ended_at: timestamp.nullable(),
    courts: count,
    players: count,
  }),
);
export type SessionRow = z.infer<typeof sessionListSchema>[number];

/** api.get_active_session_code() */
export const activeSessionCodeSchema = z.string().nullable();
