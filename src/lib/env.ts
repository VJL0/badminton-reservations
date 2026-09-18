// NEXT_PUBLIC_* values are inlined at build time, so each must be referenced literally.
// Failing here (at build, or on first request) beats a confusing runtime error in a gym.
function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing required environment variable ${name}. See .env.example.`);
  return value;
}

const supabaseUrl = required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
try {
  new URL(supabaseUrl);
} catch {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL must be a full URL, e.g. https://<ref>.supabase.co");
}

export const env = {
  SUPABASE_URL: supabaseUrl,
  SUPABASE_KEY: required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
  /** Cloudflare Turnstile site key. Unset = no CAPTCHA widget (local development only). */
  TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || undefined,
} as const;
