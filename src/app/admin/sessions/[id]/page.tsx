import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/local-time";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { idSchema } from "@/features/open-play/schemas";
import { headingClass, metaClass } from "@/features/open-play/styles";
import { formatDuration, formatPercent } from "@/lib/format";
import { hasStaffSession } from "@/lib/staff-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { SignIn } from "../../sign-in-form";
import { PlayersList } from "./players-list";
import type { Summary } from "./summary-types";

export const metadata: Metadata = { title: "Session summary" };

function Stat({ value, label, note }: { value: string; label: string; note?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl bg-card p-4 ring-1 ring-foreground/10">
      <p className="font-display text-4xl leading-none font-extrabold whitespace-nowrap max-xs:text-3xl min-[420px]:text-5xl">{value}</p>
      <p className={metaClass}>{label}</p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-sm">{label}</dt>
      <dd className="text-right font-semibold">{value}</dd>
    </div>
  );
}

export default async function SessionSummaryPage({ params }: PageProps<"/admin/sessions/[id]">) {
  if (!(await hasStaffSession())) return <SignIn />;

  const id = idSchema.safeParse((await params).id);
  if (!id.success) notFound();

  const { data, error } = await createAdminClient().rpc("get_session_summary", {
    p_session_id: id.data,
  });
  if (error) throw new Error(`get_session_summary failed: ${error.message}`);
  if (!data) notFound();
  const { session, totals, court_use, courts, players, games } = data as Summary;

  const live = session.status === "ACTIVE";
  const tracked = session.wait_tracked;
  // No-game flags first, then longest wait.
  const flagged = players
    .filter((p) => p.flags.length > 0)
    .sort(
      (a, b) =>
        Number(b.flags.includes("no_games")) - Number(a.flags.includes("no_games")) || (b.longest_wait_s ?? 0) - (a.longest_wait_s ?? 0),
    );
  const longWait = Math.max(600, session.game_duration_seconds);
  const latest = games.slice(0, 5);
  const older = games.slice(5);
  const flagCard = (p: Summary["players"][number]) => (
    <li key={p.player_id} className="rounded-xl bg-signal/10 p-3">
      <p className="font-semibold">
        <span aria-hidden className="mr-2 text-signal">
          ⚠
        </span>
        {p.name}
      </p>
      <p className="text-sm text-muted-foreground">
        {p.flags.includes("no_games") && <>0 games · here for {formatDuration(p.present_s)}. </>}
        {p.flags.includes("long_wait") && <>Longest wait {formatDuration(p.longest_wait_s)}.</>}
      </p>
    </li>
  );
  const gameLine = (g: Summary["games"][number]) => (
    <li key={g.id} className="flex flex-col gap-1 py-3">
      <p className={metaClass}>
        Court {g.court_number} · <LocalTime iso={g.started_at} part="time" />
        {g.ended_at ? (
          <>
            {" – "}
            <LocalTime iso={g.ended_at} part="time" /> · {formatDuration((Date.parse(g.ended_at) - Date.parse(g.started_at)) / 1000)}
          </>
        ) : (
          " · in progress"
        )}
      </p>
      <p className="font-semibold">{g.players.join(" · ")}</p>
    </li>
  );

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 lg:gap-8 lg:px-8 lg:py-10">
      <header className="flex flex-col gap-2">
        <Link href="/admin" className="inline-flex min-h-11 w-fit items-center text-sm text-muted-foreground underline underline-offset-4">
          ← All sessions
        </Link>
        <div className="flex flex-wrap items-center gap-x-2">
          <h1 className="min-w-0 font-display text-4xl font-extrabold tracking-display wrap-break-word uppercase">{session.name}</h1>
          <Badge className={live ? "bg-mat text-white" : ""} variant={live ? "default" : "secondary"}>
            {live ? "Live" : "Ended"}
          </Badge>
        </div>
        <p className={metaClass}>
          <LocalTime iso={session.started_at} />
          {session.ended_at && (
            <>
              {" – "}
              <LocalTime iso={session.ended_at} part="time" />
            </>
          )}{" "}
          · {session.courts} {session.courts === 1 ? "court" : "courts"} · {session.code}
        </p>
        {live && <p className="text-sm text-muted-foreground">This session is still running. Everything below is measured up to now.</p>}
      </header>

      <section aria-label="Highlights" className="grid grid-cols-2 gap-3">
        <Stat
          value={String(totals.players)}
          label="Players"
          note={totals.peak_present > 0 ? `${totals.peak_present} here at once at most` : undefined}
        />
        <Stat value={String(totals.games)} label="Games" />
        <Stat value={tracked ? formatDuration(totals.median_wait_s) : "—"} label="Median wait" note="A typical player's wait for a court" />
        <Stat value={tracked ? formatDuration(totals.longest_wait_s) : "—"} label="Longest wait" />
      </section>
      {!tracked && (
        <p className="rounded-2xl bg-card p-4 text-sm text-muted-foreground ring-1 ring-foreground/10">
          Wait times weren&apos;t recorded for this session (it ran before wait tracking existed), so waits and court-idle figures are left
          blank.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className={headingClass}>Queue &amp; fairness</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="divide-y">
            <Line label="Most people waiting at once" value={tracked ? String(totals.peak_queue) : "—"} />
            <Line label="Players who got a game" value={`${totals.played} / ${totals.players}`} />
            <Line label="Players with no game" value={String(totals.no_games)} />
          </dl>

          {flagged.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h3 className="font-display text-xl font-extrabold tracking-heading uppercase">Needs attention</h3>
              <ul className="flex flex-col gap-2">{flagged.slice(0, 3).map(flagCard)}</ul>
              {flagged.length > 3 && (
                <details className="group">
                  <summary className="min-h-11 cursor-pointer list-none py-2 text-sm font-semibold underline underline-offset-4 outline-hidden focus-visible:ring-2 focus-visible:ring-mat [&::-webkit-details-marker]:hidden">
                    <span className="group-open:hidden">Show {flagged.length - 3} more</span>
                    <span className="hidden group-open:inline">Show fewer</span>
                  </summary>
                  <ul className="flex flex-col gap-2">{flagged.slice(3).map(flagCard)}</ul>
                </details>
              )}
              <p className="text-xs text-muted-foreground">
                Flagged: no game after 10+ minutes here, or a wait longer than one full game ({formatDuration(longWait)}). A flag is a
                prompt to look, not proof the queue failed: they may have gone on a break.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {totals.players === 0
                ? "Nobody has joined yet."
                : tracked
                  ? `Nobody waited longer than a full game (${formatDuration(longWait)}), and everyone here for 10+ minutes got to play.`
                  : "Everyone who was here for 10+ minutes got to play."}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className={headingClass}>Court flow</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="divide-y">
            <Line label="Courts in use" value={formatPercent(court_use.busy_s, court_use.window_s)} />
            <Line label="Court time idle" value={formatDuration(Math.max(0, court_use.window_s - court_use.busy_s))} />
            <Line label="Idle while a full game waited" value={tracked ? formatDuration(court_use.idle_backed_s) : "—"} />
          </dl>
          <p className="text-xs text-muted-foreground">
            Idle court time is only a problem when people are waiting. The last figure counts time a court had no game while enough people
            to fill it were in the queue.
          </p>
          <ul className="flex flex-col gap-3">
            {courts.map((c) => {
              const pct = c.window_s > 0 ? Math.min(100, (c.busy_s / c.window_s) * 100) : 0;
              return (
                <li key={c.court_number} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-semibold">
                      Court {c.court_number}{" "}
                      <span className={metaClass}>
                        {c.format}
                        {c.removed && " · removed"}
                      </span>
                    </p>
                    <p className="font-semibold">{formatPercent(c.busy_s, c.window_s)}</p>
                  </div>
                  <div aria-hidden className="h-2.5 overflow-hidden rounded-full bg-foreground/10">
                    <div className="h-full rounded-full bg-mat" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatDuration(c.busy_s)} in games · {formatDuration(Math.max(0, c.window_s - c.busy_s))} idle
                  </p>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className={headingClass}>Players ({players.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <PlayersList players={players} waitTracked={tracked} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className={headingClass}>Game history ({games.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {games.length === 0 && <p className="text-muted-foreground">No games have started yet.</p>}
          <ul className="divide-y">{latest.map(gameLine)}</ul>
          {older.length > 0 && (
            <details className="group">
              <summary className="min-h-11 cursor-pointer list-none py-3 text-sm font-semibold underline underline-offset-4 outline-hidden focus-visible:ring-2 focus-visible:ring-mat [&::-webkit-details-marker]:hidden">
                <span className="group-open:hidden">Show all {games.length} games</span>
                <span className="hidden group-open:inline">Show fewer</span>
              </summary>
              <ul className="divide-y">{older.map(gameLine)}</ul>
            </details>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className={headingClass}>Session settings</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="divide-y">
            <Line label="Game length" value={`${Math.round(session.game_duration_seconds / 60)} minutes`} />
            <Line
              label="Games start"
              value={
                session.auto_start
                  ? `Automatically${session.start_delay_seconds ? ` after ${session.start_delay_seconds}s` : ""}`
                  : "When someone presses Start"
              }
            />
            <Line
              label="After a game"
              value={session.auto_requeue_on_finish ? "Players re-queue for the same court" : "Players step off"}
            />
            <Line label="Courts" value={String(session.courts)} />
          </dl>
          <a
            href={`/admin/sessions/${session.id}/export`}
            download
            className="inline-flex min-h-11 w-fit items-center rounded-full border border-foreground/30 px-5 text-sm font-semibold hover:bg-foreground/5"
          >
            Export players (CSV)
          </a>
        </CardContent>
      </Card>
    </main>
  );
}
