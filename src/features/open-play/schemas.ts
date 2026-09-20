import { z } from "zod";

export const idSchema = z.uuid();
export const nameSchema = z.string().trim().min(1, "Enter your name").max(40, "Keep it under 40 characters");
export const sessionCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{4,12}$/, "Codes are 4–12 letters or digits");

export const createSessionSchema = z.object({
  name: z.string().trim().min(1, "Name the session").max(80),
  courts: z.coerce.number().int().min(1).max(30),
  minutes: z.coerce.number().int().min(1).max(180),
  autoRequeue: z.boolean(),
});

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email"));
export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .regex(/[a-z]/, "Include a lowercase letter")
  .regex(/[A-Z]/, "Include an uppercase letter")
  .regex(/[0-9]/, "Include a digit");

const sideSize = z.coerce.number().int().min(1, "A side needs at least one player").max(4, "At most four a side");

export const courtFormatSchema = z.object({ sideA: sideSize, sideB: sideSize });

export const sessionSettingsSchema = z.object({
  minutes: z.coerce.number().int().min(1, "Games run at least 1 minute").max(180, "Games run at most 180 minutes"),
  autoRequeue: z.boolean(),
  autoStart: z.boolean(),
  startDelaySeconds: z.coerce.number().int().min(0, "The countdown can't be negative").max(300, "The countdown is at most 300 seconds"),
});
