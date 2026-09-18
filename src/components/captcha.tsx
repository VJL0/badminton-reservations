"use client";

import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import type { Ref } from "react";
import { env } from "@/lib/env";

export const captchaEnabled = Boolean(env.TURNSTILE_SITE_KEY);
export type CaptchaHandle = TurnstileInstance;

/**
 * Cloudflare Turnstile. Supabase checks the token server-side once CAPTCHA protection is on.
 * Tokens are single-use: call `ref.current?.reset()` after every failed attempt.
 */
export function Captcha({
  onToken,
  nonce,
  ref,
}: {
  onToken: (token: string | undefined) => void;
  nonce?: string;
  ref?: Ref<CaptchaHandle>;
}) {
  if (!env.TURNSTILE_SITE_KEY) return null;
  return (
    <Turnstile
      ref={ref}
      siteKey={env.TURNSTILE_SITE_KEY}
      onSuccess={onToken}
      onExpire={() => onToken(undefined)}
      onError={() => onToken(undefined)}
      options={{ size: "flexible" }}
      scriptOptions={{ nonce }}
    />
  );
}
