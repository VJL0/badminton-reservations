"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Captcha, type CaptchaHandle, captchaEnabled } from "@/components/captcha";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ctaClass } from "@/features/open-play/styles";
import { getBrowserSupabase } from "@/lib/supabase/client";

const inputClass = "h-14 rounded-xl px-4 text-lg md:text-lg";

/**
 * `resetRedirect` is where the emailed link lands (the canonical /admin/onboarding, decided by the server),
 * so a reset started from any address still comes back to the real site.
 */
export function LoginForm({ nonce, next = "/admin", resetRedirect }: { nonce?: string; next?: Route; resetRedirect: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"sign-in" | "reset">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const captcha = useRef<CaptchaHandle>(null);
  const resetting = mode === "reset";
  const captchaMissing = captchaEnabled && !token;

  function spendToken() {
    captcha.current?.reset(); // tokens are single-use
    setToken(undefined);
  }

  function signIn() {
    startTransition(async () => {
      // Browser-side so Supabase's sign-in rate limit counts this person, not Vercel's shared IP.
      const { error: signInError } = await getBrowserSupabase().auth.signInWithPassword({
        email: email.trim(),
        password,
        options: { captchaToken: token },
      });
      if (signInError) {
        // One message for every credential failure: don't reveal which emails have accounts.
        setError(signInError.status === 429 ? "Too many attempts. Wait a few minutes and try again." : "Wrong email or password.");
        spendToken();
        return;
      }
      router.replace(next); // already checked against the allow-list by the page
      router.refresh();
    });
  }

  function sendReset() {
    startTransition(async () => {
      const { error: resetError } = await getBrowserSupabase().auth.resetPasswordForEmail(email.trim(), {
        redirectTo: resetRedirect,
        captchaToken: token,
      });
      spendToken();
      if (resetError) {
        setError(
          resetError.status === 429 ? "Too many attempts. Wait a few minutes and try again." : "Couldn't send the email. Try again.",
        );
        return;
      }
      // The same answer whether or not the address has an account.
      setNotice("If that email belongs to an officer, a link to choose a new password is on its way.");
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setNotice(null);
        if (resetting) sendReset();
        else signIn();
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
        {!resetting && (
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
        )}
        {resetting && error && <FieldError>{error}</FieldError>}
        {notice && (
          <p role="status" className="text-sm text-muted-foreground">
            {notice}
          </p>
        )}
        <Captcha ref={captcha} onToken={setToken} nonce={nonce} />
        <Button type="submit" className={ctaClass} disabled={pending || !email || (!resetting && !password) || captchaMissing}>
          {resetting ? (pending ? "Sending…" : "Email me a link") : pending ? "Signing in…" : "Sign in"}
        </Button>
        <button
          type="button"
          onClick={() => {
            setMode(resetting ? "sign-in" : "reset");
            setError(null);
            setNotice(null);
          }}
          className="min-h-11 self-start text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          {resetting ? "Back to sign in" : "Forgot your password?"}
        </button>
      </FieldGroup>
    </form>
  );
}
