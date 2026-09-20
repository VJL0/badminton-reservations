import { z } from "zod";
import { guid, timestamp } from "./shared";

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email"));
export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .regex(/[a-z]/, "Include a lowercase letter")
  .regex(/[A-Z]/, "Include an uppercase letter")
  .regex(/[0-9]/, "Include a digit");

export const staffRoleSchema = z.enum(["ADMIN", "OPERATOR"]);
export type StaffRole = z.infer<typeof staffRoleSchema>;

/** api.list_staff() */
export const staffListSchema = z.array(
  z.object({
    user_id: guid,
    email: z.string().nullable(),
    role: staffRoleSchema,
    created_at: timestamp,
    last_sign_in_at: timestamp.nullable(),
  }),
);
export type StaffRow = z.infer<typeof staffListSchema>[number];
