"use client";

import { useActionState, useState, useTransition } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { createSessionForm, endSession } from "@/features/open-play/actions/admin";
import type { FormState } from "@/features/open-play/actions/form-state";
import { addAdminForm, changePasswordForm, resetAdminPassword } from "@/features/open-play/actions/staff";
import { ConfirmButton } from "@/features/open-play/components/confirm-button";
import { QrButton } from "@/features/open-play/components/qr-button";

export function SessionQr({ url, code }: { url: string; code: string }) {
  return <QrButton url={url} code={code} size={72} />;
}

export function EndSessionButton({ sessionId }: { sessionId: string }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <ConfirmButton
        label="End session"
        confirmLabel="Confirm end"
        onConfirm={async () => {
          // The action refreshes the page itself (next/cache refresh), so the list updates in the same round trip.
          const res = await endSession(sessionId);
          setError(res.ok ? null : res.error);
        }}
      />
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );
}

/** Shared bottom of every form: the error, or a success note, and the submit button. */
function FormFooter({ state, pending, label }: { state: FormState; pending: boolean; label: string }) {
  return (
    <>
      {state?.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      {state?.ok && state.message && (
        <Alert>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" disabled={pending} className="w-fit">
        {label}
      </Button>
    </>
  );
}

// These are real <form action> forms: they work before JavaScript loads, and React shows the pending state.
// After an error the fields are refilled from `state.values` (React clears uncontrolled fields after every action).
export function CreateSessionForm() {
  const [state, action, pending] = useActionState(createSessionForm, null);
  const v = state?.values;

  return (
    <form action={action}>
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-[1fr_7rem_7rem]">
          <Field>
            <FieldLabel htmlFor="session-name">Session name</FieldLabel>
            <Input
              id="session-name"
              name="name"
              required
              maxLength={80}
              placeholder="Friday Open Play"
              defaultValue={String(v?.name ?? "")}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="session-courts">Courts</FieldLabel>
            <Input id="session-courts" name="courts" type="number" min={1} max={30} defaultValue={String(v?.courts ?? 3)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="session-minutes">Minutes per game</FieldLabel>
            <Input id="session-minutes" name="minutes" type="number" min={1} max={180} defaultValue={String(v?.minutes ?? 20)} />
          </Field>
        </div>
        <Field orientation="horizontal">
          <Switch id="auto-requeue" name="autoRequeue" defaultChecked={v?.autoRequeue === true} />
          <FieldLabel htmlFor="auto-requeue">Automatically re-queue players when their game ends</FieldLabel>
        </Field>
        <FormFooter state={state} pending={pending} label="Create session" />
      </FieldGroup>
    </form>
  );
}

export function AddAdminForm() {
  const [state, action, pending] = useActionState(addAdminForm, null);

  return (
    <form action={action}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="admin-email">Email</FieldLabel>
          <Input
            id="admin-email"
            name="email"
            type="email"
            required
            autoComplete="off"
            placeholder="new.admin@example.com"
            defaultValue={String(state?.values?.email ?? "")}
          />
          <p className="text-muted-foreground text-xs">
            They sign in with this email and the default password, and are asked to change it right away.
          </p>
        </Field>
        <FormFooter state={state} pending={pending} label="Add admin" />
      </FieldGroup>
    </form>
  );
}

export function ResetPasswordButton({ userId }: { userId: string }) {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col items-end gap-1">
      <ConfirmButton
        label="Reset password"
        confirmLabel="Confirm reset"
        disabled={pending}
        onConfirm={() =>
          startTransition(async () => {
            const res = await resetAdminPassword(userId);
            setMessage(res.ok ? { ok: true, text: "Reset to the default password." } : { ok: false, text: res.error });
          })
        }
      />
      {message && (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-muted-foreground text-xs" : "text-destructive text-xs"}>
          {message.text}
        </p>
      )}
    </div>
  );
}

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePasswordForm, null);

  return (
    <form action={action}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="new-password">New password</FieldLabel>
          <Input id="new-password" name="password" type="password" required autoComplete="new-password" minLength={10} />
          <p className="text-muted-foreground text-xs">At least 10 characters with upper case, lower case and a digit.</p>
        </Field>
        <FormFooter state={state} pending={pending} label="Change password" />
      </FieldGroup>
    </form>
  );
}
