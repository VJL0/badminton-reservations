"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { createSession, endSession } from "@/features/open-play/actions/admin";
import { QrButton } from "@/features/open-play/components/qr-button";
import { addAdmin, changeMyPassword, resetAdminPassword } from "@/features/open-play/actions/staff";
import { ConfirmButton } from "@/features/open-play/components/confirm-button";

export function SessionQr({ url, code }: { url: string; code: string }) {
  return <QrButton url={url} code={code} />;
}

export function EndSessionButton({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <ConfirmButton
        label="End session"
        confirmLabel="Confirm end"
        onConfirm={async () => {
          const res = await endSession(sessionId);
          setError(res.ok ? null : res.error);
          router.refresh();
        }}
      />
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function CreateSessionForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [autoRequeue, setAutoRequeue] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        startTransition(async () => {
          const res = await createSession({
            name: String(f.get("name")),
            courts: Number(f.get("courts")),
            minutes: Number(f.get("minutes")),
            autoRequeue,
          });
          if (res.ok) {
            form.reset();
            setAutoRequeue(false);
            setError(null);
            router.refresh();
          } else setError(res.error);
        });
      }}
    >
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-[1fr_7rem_7rem]">
          <Field>
            <FieldLabel htmlFor="session-name">Session name</FieldLabel>
            <Input id="session-name" name="name" required maxLength={80} placeholder="Friday Open Play" />
          </Field>
          <Field>
            <FieldLabel htmlFor="session-courts">Courts</FieldLabel>
            <Input id="session-courts" name="courts" type="number" min={1} max={30} defaultValue={3} />
          </Field>
          <Field>
            <FieldLabel htmlFor="session-minutes">Minutes per game</FieldLabel>
            <Input id="session-minutes" name="minutes" type="number" min={1} max={180} defaultValue={20} />
          </Field>
        </div>
        <Field orientation="horizontal">
          <Switch id="auto-requeue" checked={autoRequeue} onCheckedChange={setAutoRequeue} />
          <FieldLabel htmlFor="auto-requeue">Automatically re-queue players when their game ends</FieldLabel>
        </Field>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" disabled={pending} className="w-fit">Create session</Button>
      </FieldGroup>
    </form>
  );
}

export function AddAdminForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const email = String(new FormData(form).get("email"));
        startTransition(async () => {
          const res = await addAdmin(email);
          if (res.ok) {
            form.reset();
            setError(null);
            router.refresh();
          } else setError(res.error);
        });
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="admin-email">Email</FieldLabel>
          <Input id="admin-email" name="email" type="email" required autoComplete="off" placeholder="new.admin@example.com" />
          <p className="text-xs text-muted-foreground">
            They sign in with this email and the default password, and are asked to change it right away.
          </p>
        </Field>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" disabled={pending} className="w-fit">Add admin</Button>
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
        <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
          {message.text}
        </p>
      )}
    </div>
  );
}

export function ChangePasswordForm() {
  const router = useRouter();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const password = String(new FormData(form).get("password"));
        startTransition(async () => {
          const res = await changeMyPassword(password);
          if (res.ok) {
            form.reset();
            setMessage({ ok: true, text: "Password changed." });
            router.refresh();
          } else setMessage({ ok: false, text: res.error });
        });
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="new-password">New password</FieldLabel>
          <Input id="new-password" name="password" type="password" required autoComplete="new-password" minLength={10} />
          <p className="text-xs text-muted-foreground">At least 10 characters with upper case, lower case and a digit.</p>
        </Field>
        {message && (
          <Alert variant={message.ok ? "default" : "destructive"}>
            <AlertDescription>{message.text}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" disabled={pending} className="w-fit">Change password</Button>
      </FieldGroup>
    </form>
  );
}
