"use client";

import { QRCodeSVG } from "qrcode.react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { createSession, endSession } from "@/features/open-play/actions/admin";
import { ConfirmButton } from "@/features/open-play/components/confirm-button";

export function SessionQr({ url }: { url: string }) {
  return (
    <div className="rounded-xl bg-white p-2">
      <QRCodeSVG value={url} size={88} />
    </div>
  );
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
