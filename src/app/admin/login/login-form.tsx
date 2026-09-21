"use client";

import type { Route } from "next";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { ctaClass } from "@/features/open-play/styles";
import { getBrowserSupabase } from "@/lib/supabase/client";

/**
 * Starts Google sign-in (Supabase's PKCE flow). The browser leaves for Google and comes back to /auth/callback on
 * this same origin, which is where the verifier cookie was set. Google only says who this is; whether they are
 * staff is the database's call once they land.
 */
export function LoginForm({ next = "/admin", initialError }: { next?: Route; initialError?: string }) {
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [pending, startTransition] = useTransition();

  function signIn() {
    setError(null);
    startTransition(async () => {
      const { error: signInError } = await getBrowserSupabase().auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
          queryParams: { prompt: "select_account" }, // people often have a personal and a work Google account signed in
        },
      });
      // On success the browser is already on its way to Google; only a failure to start comes back here.
      if (signInError) setError("Couldn't start Google sign-in. Try again.");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Button type="button" className={ctaClass} disabled={pending} onClick={signIn}>
        {pending ? "Opening Google…" : "Continue with Google"}
      </Button>
      {error && <FieldError>{error}</FieldError>}
    </div>
  );
}
