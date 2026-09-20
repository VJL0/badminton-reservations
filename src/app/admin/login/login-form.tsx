"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Captcha, captchaEnabled, type CaptchaHandle } from "@/components/captcha";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ctaClass } from "@/features/open-play/styles";
import { createClient } from "@/lib/supabase/client";

const inputClass = "h-14 rounded-xl px-4 text-lg md:text-lg";

export function LoginForm({ nonce, next = "/admin" }: { nonce?: string; next?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const captcha = useRef<CaptchaHandle>(null);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          // Browser-side so Supabase's sign-in rate limit counts this person, not Vercel's shared IP.
          const { error: signInError } = await createClient().auth.signInWithPassword({
            email: email.trim(),
            password,
            options: { captchaToken: token },
          });
          if (signInError) {
            // One message for every credential failure: don't reveal which emails have accounts.
            setError(signInError.status === 429 ? "Too many attempts. Wait a few minutes and try again." : "Wrong email or password.");
            captcha.current?.reset();
            setToken(undefined);
            return;
          }
          router.replace(next); // already checked against the allow-list by the page
          router.refresh();
        });
      }}
    >
      <FieldGroup>
        <Field data-invalid={!!error}>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            aria-invalid={!!error}
            className={inputClass}
          />
        </Field>
        <Field data-invalid={!!error}>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!error}
            className={inputClass}
          />
          {error && <FieldError>{error}</FieldError>}
        </Field>
        <Captcha ref={captcha} onToken={setToken} nonce={nonce} />
        <Button type="submit" className={ctaClass} disabled={pending || !email || !password || (captchaEnabled && !token)}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </FieldGroup>
    </form>
  );
}
