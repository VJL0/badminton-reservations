"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { firstIssue, passwordSchema } from "@/features/open-play/schemas";
import { ctaClass } from "@/features/open-play/styles";
import { getBrowserSupabase } from "@/lib/supabase/client";

type LinkState = "checking" | "signed-in" | "missing";

/**
 * Turn the link that was just opened into a signed-in session. Supabase can hand it over three ways:
 *  - `?code=` (the person asked for a password reset from this browser): the client exchanges it as it starts;
 *  - `#access_token=…` (an invitation, from the default email template): the browser client only follows the
 *    PKCE flow, so it refuses this style of link and the tokens are taken over here;
 *  - `?token_hash=…` (an email template customised to the recommended server-side style).
 * Either way the address is cleaned afterwards so tokens do not linger in the history.
 */
async function establishSession(): Promise<boolean> {
  const supabase = getBrowserSupabase();
  const signedIn = async () => {
    const { data } = await supabase.auth.getSession();
    return !!data.session && !data.session.user.is_anonymous;
  };
  if (await signedIn()) return true; // waits for the client to start, which also handles ?code=

  const url = new URL(window.location.href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const accessToken = fragment.get("access_token");
  const refreshToken = fragment.get("refresh_token");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");

  window.history.replaceState(null, "", url.pathname);
  if (accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (error) return false;
  } else if (tokenHash && (type === "invite" || type === "recovery")) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) return false;
  } else {
    return false;
  }
  return signedIn();
}

export function OnboardingForm() {
  const router = useRouter();
  const [link, setLink] = useState<LinkState>("checking");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    void establishSession().then((ok) => {
      if (!cancelled) setLink(ok ? "signed-in" : "missing");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (link === "checking") return <p className="text-sm text-muted-foreground">One sec…</p>;
  if (link === "missing") {
    return (
      <div className="flex flex-col gap-4">
        <p role="alert" className="text-sm text-muted-foreground">
          This link has expired or was already used. Ask an admin to send the invitation again, or choose &ldquo;Forgot your
          password?&rdquo; on the sign-in page.
        </p>
        <Link href="/admin/login" className="inline-flex min-h-11 w-fit items-center text-sm underline underline-offset-4">
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const parsed = passwordSchema.safeParse(password);
        if (!parsed.success) return setError(firstIssue(parsed.error));
        startTransition(async () => {
          // Browser-side: the person is already signed in through the link, and this call needs no CAPTCHA.
          const { error: updateError } = await getBrowserSupabase().auth.updateUser({ password: parsed.data });
          if (updateError) return setError(updateError.message);
          router.replace("/admin");
          router.refresh();
        });
      }}
    >
      <FieldGroup>
        <Field data-invalid={!!error}>
          <FieldLabel htmlFor="new-password">New password</FieldLabel>
          <Input
            id="new-password"
            type="password"
            required
            autoFocus
            autoComplete="new-password"
            minLength={10}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!error}
            className="h-14 rounded-xl px-4 text-lg md:text-lg"
          />
          <p className="text-xs text-muted-foreground">At least 10 characters with upper case, lower case and a digit.</p>
          {error && <FieldError>{error}</FieldError>}
        </Field>
        <Button type="submit" className={ctaClass} disabled={pending || !password}>
          {pending ? "Saving…" : "Save password"}
        </Button>
      </FieldGroup>
    </form>
  );
}
