"use client";

import { useActionState } from "react";
import { CenteredPage } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { verifyStaffCodeForm } from "@/features/open-play/actions/staff-auth";
import { ctaClass } from "@/features/open-play/styles";

const inputClass = "h-14 rounded-xl px-4 text-lg md:text-lg";

/** Shown in place of a staff page when signed out. Signing in re-renders that page. */
export function SignIn() {
  const [state, action, pending] = useActionState(verifyStaffCodeForm, null);

  return (
    <CenteredPage eyebrow="Staff" title="Sign in" description="Enter the staff code.">
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
    </CenteredPage>
  );
}
