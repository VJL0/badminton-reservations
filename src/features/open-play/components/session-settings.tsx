"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { addCourt, deleteCourt, updateCourt, updateSessionSettings } from "../actions/session-config";
import type { ActionResult } from "../actions/rpc";
import { ConfirmButton } from "./confirm-button";
import { formatLabel, type Snapshot } from "../types";

type Run = (action: () => Promise<ActionResult>) => void;

const PRESETS: [number, number][] = [
  [1, 1],
  [2, 2],
  [1, 2],
  [2, 3],
];

const label = "font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2";
const select =
  "h-11 rounded-xl border border-input bg-white px-2 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-mat disabled:opacity-50";

/** Players per side: two dropdowns plus one-tap presets (1v1, 2v2, 1v2, 2v3). */
function FormatPicker({ a, b, onChange, disabled }: { a: number; b: number; onChange: (a: number, b: number) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1" role="group" aria-label="Format presets">
        {PRESETS.map(([x, y]) => (
          <Button
            key={`${x}${y}`}
            type="button"
            className="h-11 px-4"
            variant={a === x && b === y ? "default" : "outline"}
            disabled={disabled}
            onClick={() => onChange(x, y)}
          >
            {x}v{y}
          </Button>
        ))}
      </div>
      <span className="flex items-center gap-1.5">
        <select aria-label="Players on side A" className={select} value={a} disabled={disabled} onChange={(e) => onChange(Number(e.target.value), b)}>
          {[1, 2, 3, 4].map((n) => <option key={n}>{n}</option>)}
        </select>
        <span className="text-sm font-semibold">v</span>
        <select aria-label="Players on side B" className={select} value={b} disabled={disabled} onChange={(e) => onChange(a, Number(e.target.value))}>
          {[1, 2, 3, 4].map((n) => <option key={n}>{n}</option>)}
        </select>
      </span>
    </div>
  );
}

function CourtRow({ court, only, busy, run }: { court: Snapshot["courts"][number]; only: boolean; busy: boolean; run: Run }) {
  const [a, setA] = useState(court.side_a_size);
  const [b, setB] = useState(court.side_b_size);
  const playing = court.round?.status === "ACTIVE";
  const dirty = a !== court.side_a_size || b !== court.side_b_size;
  const waiting = court.round?.players.length ?? 0;
  const bumped = dirty && court.round?.status === "FILLING" ? Math.max(0, waiting - (a + b)) : 0;

  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-baseline gap-2">
        <span className="font-display text-2xl font-extrabold">Court {court.court_number}</span>
        <span className={label}>{formatLabel(court)}</span>
      </div>
      <div className="flex flex-col gap-1.5 sm:items-end">
        <div className="flex flex-wrap items-center gap-2">
          <FormatPicker a={a} b={b} onChange={(x, y) => (setA(x), setB(y))} disabled={busy || playing} />
          <Button type="button" className="h-11 px-4" disabled={busy || playing || !dirty} onClick={() => run(() => updateCourt(court.id, a, b))}>
            Apply
          </Button>
          <ConfirmButton
            label="Delete"
            confirmLabel="Confirm delete"
            disabled={busy || playing || only}
            onConfirm={() => run(() => deleteCourt(court.id))}
          />
        </div>
        {playing && <p className="text-xs text-ink-2">A game is running. Change or delete the court once it ends.</p>}
        {only && !playing && <p className="text-xs text-ink-2">A session needs at least one court.</p>}
        {bumped > 0 && <p className="text-xs text-ink-2">{bumped} waiting {bumped === 1 ? "player goes" : "players go"} back to the queue.</p>}
      </div>
    </li>
  );
}

/** Admin-only panel: game length, auto-start, auto re-queue, and the court list. */
export function SessionSettings({ snapshot, busy, run }: { snapshot: Snapshot; busy: boolean; run: Run }) {
  const { session, courts } = snapshot;
  const [open, setOpen] = useState(false);

  return (
    <section aria-label="Session settings" className="flex flex-col gap-3 rounded-[24px] border-2 border-ink/15 bg-white px-5 py-4 lg:px-[34px]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-pointer items-center justify-between gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-mat"
      >
        <span className="flex flex-col gap-1">
          <span className="font-display text-2xl font-extrabold uppercase tracking-[0.04em]">Session settings</span>
          <span className={label}>
            {Math.round(session.game_duration_seconds / 60)} min games ·{" "}
            {session.auto_start ? `auto-start${session.start_delay_seconds ? ` after ${session.start_delay_seconds}s` : ""}` : "manual start"} ·{" "}
            {courts.length} courts{session.auto_requeue_on_finish && " · auto re-queue"}
          </span>
        </span>
        <span aria-hidden className={cn("text-xl transition-transform", open && "rotate-180")}>⌄</span>
      </button>

      {open && (
        <div className="flex flex-col gap-5 border-t border-ink/10 pt-4">
          {/* Remount on server change so the form never shows stale values. */}
          <SettingsForm
            key={`${session.game_duration_seconds}-${session.auto_start}-${session.start_delay_seconds}-${session.auto_requeue_on_finish}`}
            snapshot={snapshot}
            busy={busy}
            run={run}
          />
          <div className="flex flex-col gap-1">
            <h3 className="font-display text-xl font-extrabold uppercase tracking-[0.04em]">Courts</h3>
            <ul className="divide-y divide-ink/10">
              {courts.map((c) => (
                <CourtRow key={`${c.id}-${c.side_a_size}-${c.side_b_size}`} court={c} only={courts.length <= 1} busy={busy} run={run} />
              ))}
            </ul>
            <AddCourt sessionId={session.id} full={courts.length >= 30} busy={busy} run={run} />
          </div>
        </div>
      )}
    </section>
  );
}

function SettingsForm({ snapshot, busy, run }: { snapshot: Snapshot; busy: boolean; run: Run }) {
  const { session } = snapshot;
  const [minutes, setMinutes] = useState(String(Math.round(session.game_duration_seconds / 60)));
  const [autoStart, setAutoStart] = useState(session.auto_start);
  const [delay, setDelay] = useState(String(session.start_delay_seconds));
  const [autoRequeue, setAutoRequeue] = useState(session.auto_requeue_on_finish);
  const dirty =
    Number(minutes) * 60 !== session.game_duration_seconds ||
    autoStart !== session.auto_start ||
    Number(delay) !== session.start_delay_seconds ||
    autoRequeue !== session.auto_requeue_on_finish;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() =>
          updateSessionSettings(session.id, {
            minutes: Number(minutes),
            autoRequeue,
            autoStart,
            startDelaySeconds: autoStart ? Number(delay) : session.start_delay_seconds,
          }),
        );
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className={label}>Minutes per game</span>
          <Input type="number" className="h-11" inputMode="numeric" min={1} max={180} required value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          <span className="text-xs text-ink-2">Applies to games that start from now on.</span>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={label}>Start countdown (seconds)</span>
          <Input
            type="number"
            className="h-11"
            inputMode="numeric"
            min={0}
            max={300}
            required
            disabled={!autoStart}
            value={delay}
            onChange={(e) => setDelay(e.target.value)}
          />
          <span className="text-xs text-ink-2">How long a full court waits before its game starts. 0 starts at once.</span>
        </label>
      </div>
      <label className="flex items-center gap-3">
        <Switch checked={autoStart} onCheckedChange={setAutoStart} />
        <span className="text-sm font-semibold">
          Auto-start games when a court fills
          <span className="block text-xs font-normal text-ink-2">Off: someone on the court (or an officer) presses Start.</span>
        </span>
      </label>
      <label className="flex items-center gap-3">
        <Switch checked={autoRequeue} onCheckedChange={setAutoRequeue} />
        <span className="text-sm font-semibold">
          Auto re-queue when a game ends
          <span className="block text-xs font-normal text-ink-2">Players line up again for the same court.</span>
        </span>
      </label>
      <Button type="submit" className="w-fit" disabled={busy || !dirty}>Save settings</Button>
    </form>
  );
}

function AddCourt({ sessionId, full, busy, run }: { sessionId: string; full: boolean; busy: boolean; run: Run }) {
  const [a, setA] = useState(2);
  const [b, setB] = useState(2);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink/10 pt-3">
      <span className={label}>New court</span>
      <div className="flex flex-wrap items-center gap-2">
        <FormatPicker a={a} b={b} onChange={(x, y) => (setA(x), setB(y))} disabled={busy || full} />
        <Button type="button" className="h-11 px-4" disabled={busy || full} onClick={() => run(() => addCourt(sessionId, a, b))}>
          Add court
        </Button>
      </div>
      {full && <p className="w-full text-xs text-ink-2">A session can have at most 30 courts.</p>}
    </div>
  );
}
