import { z } from "zod";
import { guid, timestamp } from "./shared";

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email"));
export const staffRoleSchema = z.enum(["ADMIN", "OPERATOR"]);
export type StaffRole = z.infer<typeof staffRoleSchema>;

/** api.list_staff() */
export const staffListSchema = z.array(
  z.object({
    email: z.string(),
    role: staffRoleSchema,
    /** Null until that person first signs in with Google. */
    user_id: guid.nullable(),
    created_at: timestamp,
    last_sign_in_at: timestamp.nullable(),
  }),
);
export type StaffRow = z.infer<typeof staffListSchema>[number];

/** What the "Add staff" form sends. */
export const authorizeStaffSchema = z.object({ email: emailSchema, role: staffRoleSchema });
