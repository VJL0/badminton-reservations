"use client";

import { useMemo, useState } from "react";
import { LocalTime } from "@/components/local-time";
import { formatDuration } from "@/lib/format";
import type { PlayerStat } from "./summary-types";

const SORTS = {
  games: {
    label: "Games played",
    cmp: (a: PlayerStat, b: PlayerStat) => b.games - a.games || a.name.localeCompare(b.name),
  },
  longest: {
    label: "Longest wait",
    cmp: (a: PlayerStat, b: PlayerStat) => (b.longest_wait_s ?? -1) - (a.longest_wait_s ?? -1),
  },
  waiting: {
    label: "Total waiting",
    cmp: (a: PlayerStat, b: PlayerStat) => b.waiting_s - a.waiting_s,
  },
  playing: {
    label: "Time playing",
    cmp: (a: PlayerStat, b: PlayerStat) => b.playing_s - a.playing_s,
  },
  name: {
    label: "Name",
    cmp: (a: PlayerStat, b: PlayerStat) => a.name.localeCompare(b.name),
  },
} as const;

const PREVIEW = 8;
const meta = "font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground";

/** Stacked cards, not a table: a table's columns don't fit a phone. Tap a player for the full breakdown. */
export function PlayersList({ players, waitTracked }: { players: PlayerStat[]; waitTracked: boolean }) {
  const [sort, setSort] = useState<keyof typeof SORTS>("games");
  const [all, setAll] = useState(false);
  const sorted = useMemo(() => [...players].sort(SORTS[sort].cmp), [players, sort]);
  const shown = all ? sorted : sorted.slice(0, PREVIEW);

  if (players.length === 0) return <p className="text-muted-foreground">Nobody has joined yet.</p>;

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-sm">
        <span className={meta}>Sort by</span>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as keyof typeof SORTS)}
          className="h-11 rounded-xl border border-input bg-white px-3 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-mat"
        >
          {Object.entries(SORTS).map(([key, s]) => (
            <option key={key} value={key}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      <ul className="divide-y">
        {shown.map((p) => (
          <li key={p.player_id}>
            <details className="group">
              <summary className="flex min-h-14 cursor-pointer list-none flex-col justify-center gap-0.5 py-2 outline-none focus-visible:ring-2 focus-visible:ring-mat [&::-webkit-details-marker]:hidden">
                <span className="flex items-center justify-between gap-2">
                  <span className="min-w-0 break-words font-semibold">
                    {p.name}
                    {p.flags.length > 0 && (
                      <span role="img" aria-label="Needs attention" className="ml-2 text-signal">
                        ⚠
                      </span>
                    )}
                  </span>
                  <span aria-hidden className="text-muted-foreground transition-transform group-open:rotate-180">
                    ⌄
                  </span>
                </span>
                <span className="text-sm text-muted-foreground">
                  {p.games} {p.games === 1 ? "game" : "games"} · {formatDuration(p.playing_s)} playing
                  {waitTracked && <> · {formatDuration(p.waiting_s)} waiting</>}
                </span>
                <span className={meta}>
                  <LocalTime iso={p.first_seen} part="time" /> – <LocalTime iso={p.last_seen} part="time" />
                </span>
              </summary>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 pb-3 pt-1 text-sm">
                <Row label="Here for" value={formatDuration(p.present_s)} />
                <Row label="Games" value={String(p.games)} />
                <Row label="Playing" value={formatDuration(p.playing_s)} />
                <Row label="Waiting" value={waitTracked ? formatDuration(p.waiting_s) : "—"} />
                <Row label="Longest wait" value={waitTracked ? formatDuration(p.longest_wait_s) : "—"} />
              </dl>
            </details>
          </li>
        ))}
      </ul>

      {players.length > PREVIEW && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="min-h-11 self-start rounded-xl px-2 text-sm font-semibold underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-mat"
        >
          {all ? "Show fewer" : `Show all ${players.length} players`}
        </button>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className={meta}>{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}
