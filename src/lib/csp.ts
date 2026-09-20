import { env } from "@/lib/env";

/**
 * Strict, nonce-based Content Security Policy (see the Next.js CSP guide). Every page is rendered
 * per request so Next can stamp the nonce on its scripts; `strict-dynamic` then trusts what those
 * scripts load (including the Turnstile script).
 */
export function buildCsp(nonce: string) {
  const dev = process.env.NODE_ENV === "development";
  const supabase = new URL(env.SUPABASE_URL);
  const secure = supabase.protocol === "https:";
  const realtime = `${secure ? "wss" : "ws"}://${supabase.host}`;
  const turnstile = "https://challenges.cloudflare.com";

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${turnstile}${dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'", // React style={{}} attributes; cannot carry a nonce
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${supabase.origin} ${realtime}`,
    `frame-src ${turnstile}`,
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(secure && !dev ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}
