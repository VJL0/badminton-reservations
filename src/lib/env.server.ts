import "server-only";
import { z } from "zod";

/**
 * Server-only settings, validated once. (env.ts holds the NEXT_PUBLIC_* values the browser also sees.)
 * Like env.ts, failing here, at build or on first request, beats a confusing runtime error in a gym.
 */
const production = process.env.NODE_ENV === "production";

// The one address this app is known by: the printed join QR and push deep links.
// Never derived from request headers, so a preview deployment or a stray Host header cannot change it.
// On Vercel it falls back to the project's production domain; elsewhere it must be set in production.
const vercelDomain = process.env.VERCEL_PROJECT_PRODUCTION_URL;
const appUrl = process.env.APP_URL || (vercelDomain ? `https://${vercelDomain}` : production ? undefined : "http://127.0.0.1:3000");

const schema = z.object({
  APP_URL: z
    .url({
      protocol: /^https?$/,
      error: (issue) =>
        issue.input === undefined
          ? "is not set (e.g. https://badminton.example.com)"
          : "must be a full URL, e.g. https://badminton.example.com",
    })
    .transform((u) => new URL(u).origin),
  /** sb_secret_… (the legacy service_role key still works). Unset = the features that need it are switched off. */
  SUPABASE_SECRET_KEY: z.string().min(1).optional(),
});

const parsed = schema.safeParse({
  APP_URL: appUrl,
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || undefined,
});
if (!parsed.success) {
  const problems = parsed.error.issues.map((i) => `${i.path.join(".") || "env"}: ${i.message}`).join("; ");
  throw new Error(`Invalid server environment (${problems}). See .env.example.`);
}

export const serverEnv = parsed.data;
