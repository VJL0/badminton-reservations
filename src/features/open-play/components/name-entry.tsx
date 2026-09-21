"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Captcha, type CaptchaHandle, captchaEnabled } from "@/components/captcha";
import { CenteredPage } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { saveDisplayName } from "../actions/save-display-name";
import { settle } from "../client/settle";
import { ctaClass } from "../styles";

/**
 * The first thing a new player sees, on the permanent QR page (or on a session link opened without a login).
 * Nothing is created until they press Continue: only then is an anonymous login made (behind the CAPTCHA) and the
 * name saved. The page then re-renders on the server, which asks the database which session is live and goes there,
 * or waits for one.
 *
 * `hasSession`: this browser is already signed in, so the CAPTCHA that guards creating a login is not needed.
 */
export function NameEntry({ sessionCode, nonce, hasSession }: { sessionCode?: string; nonce?: string; hasSession: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [token, setToken] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const captcha = useRef<CaptchaHandle>(null);

  function fail(message: string) {
    setError(message);
    captcha.current?.reset(); // tokens are single-use
    setToken(undefined);
  }

  function submit(e: React.SyntheticEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const supabase = getBrowserSupabase();
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        // Signing in from the browser keeps Supabase's per-IP rate limit per player.
        const { error: signInError } = await supabase.auth.signInAnonymously({
          options: { captchaToken: token },
        });
        if (signInError) {
          return fail(
            signInError.status === 429
              ? "Too many sign-ins from this network. Try again in a few minutes."
              : "Couldn't sign you in. Check your connection and try again.",
          );
        }
      }
      const res = await settle(() => saveDisplayName(name));
      if (!res.ok) return fail(res.error);
      router.refresh();
    });
  }

  return (
    <CenteredPage
      eyebrow={sessionCode ? `Open play · ${sessionCode.toUpperCase()}` : "Open play"}
      title="What's your name?"
      description="Others see it on the court board. No account needed."
    >
      <form onSubmit={submit}>
        <FieldGroup>
          <Field data-invalid={!!error}>
            <FieldLabel htmlFor="display-name">Your name</FieldLabel>
            <Input
              id="display-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              autoComplete="name"
              placeholder="John Doe"
              aria-invalid={!!error}
              className="h-14 rounded-xl px-4 text-lg md:text-lg"
            />
            {error && <FieldError>{error}</FieldError>}
          </Field>
          {!hasSession && <Captcha ref={captcha} onToken={setToken} nonce={nonce} />}
          <Button type="submit" className={ctaClass} disabled={pending || !name.trim() || (captchaEnabled && !hasSession && !token)}>
            {pending ? "One sec…" : "Continue"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Staff?{" "}
            <Link href="/admin/login" className="underline underline-offset-4 hover:text-foreground">
              Sign in
            </Link>
          </p>
        </FieldGroup>
      </form>
    </CenteredPage>
  );
}
