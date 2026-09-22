"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { verifyStaffCodeForm } from "@/features/open-play/actions/staff-auth";
import { ctaClass } from "@/features/open-play/styles";

const inputClass = "h-14 rounded-xl px-4 text-lg md:text-lg";

export function LoginForm({ next = "/admin" }: { next?: Route }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(verifyStaffCodeForm, null);

  useEffect(() => {
    if (state?.ok) {
      router.replace(next); // already checked against the allow-list by the page
      router.refresh();
    }
  }, [state?.ok, next, router]);

  return (
    <form action={action}>
      <FieldGroup>
        <Field data-invalid={!!state?.error}>
          <FieldLabel htmlFor="code">Staff code</FieldLabel>
          <Input id="code" name="code" type="password" required autoComplete="off" aria-invalid={!!state?.error} className={inputClass} />
          {state?.error && <FieldError>{state.error}</FieldError>}
        </Field>
        <Button type="submit" className={ctaClass} disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </FieldGroup>
    </form>
  );
}
