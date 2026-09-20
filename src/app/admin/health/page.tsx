import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CenteredPage } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getIdentity } from "@/features/open-play/server/auth";
import { getOpsHealth } from "@/features/open-play/server/queries";
import { headingClass, metaClass } from "@/features/open-play/styles";
import { formatDuration } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "System health" };

// Signals worth acting on. They are the questions to ask before deciding that Postgres "isn't scaling".
const PUSH_MAX_AGE_S = 30; // a notification older than this is waiting on the worker
const TIMER_MAX_AGE_MS = 90_000; // the timers run every 30 s

type Check = { label: string; ok: boolean; detail: string };

export default async function HealthPage() {
  const me = await getIdentity();
  if (!me) redirect("/admin/login");
  if (me.role !== "ADMIN") redirect("/admin");

  const health = await getOpsHealth(await createClient());
  const now = Date.parse(health.now);

  const checks: Check[] = [
    {
      label: "Notification queue",
      ok: !health.push.enabled || health.push.queued === 0 || (health.push.oldest_age_s ?? 0) <= PUSH_MAX_AGE_S,
      detail: !health.push.enabled
        ? "Push is switched off (no worker URL and secret in Vault)."
        : health.push.queued === 0
          ? `Empty. ${health.push.delivered_or_dropped} delivered or dropped so far.`
          : `${health.push.queued} waiting, the oldest for ${formatDuration(health.push.oldest_age_s)}.`,
    },
    ...(health.timers.length === 0
      ? [
          {
            label: "Timers",
            ok: false,
            detail: "No timer is scheduled (pg_cron). Games are only ended by phones that have the board open.",
          },
        ]
      : health.timers.map((t) => {
          const age = t.last_run_at ? now - Date.parse(t.last_run_at) : Number.POSITIVE_INFINITY;
          const late = t.active && age > TIMER_MAX_AGE_MS;
          return {
            label: `Timer: ${t.name}`,
            ok: t.active && !late && t.failures_24h === 0,
            detail: !t.active
              ? "Switched off."
              : `${t.schedule}. Last run ${t.last_run_at ? `${formatDuration(age / 1000)} ago (${t.last_status})` : "never"}. ${t.failures_24h} failures in 24 h.`,
          };
        })),
  ];

  const snap = health.get_snapshot;
  return (
    <CenteredPage eyebrow="Officers" title="System health" className="max-w-xl">
      <Link href="/admin" className="inline-flex min-h-11 w-fit items-center text-sm text-muted-foreground underline underline-offset-4">
        ← Officer console
      </Link>
      <section aria-label="Checks" className="flex flex-col gap-3">
        {checks.map((c) => (
          <Card key={c.label} className={c.ok ? undefined : "border-signal"}>
            <CardContent className="flex flex-col gap-1">
              <p className="font-semibold">
                <span aria-hidden className={c.ok ? "mr-2 text-mat" : "mr-2 text-signal"}>
                  {c.ok ? "✓" : "⚠"}
                </span>
                {c.label}
                <span className="sr-only">{c.ok ? " is fine" : " needs attention"}</span>
              </p>
              <p className="text-sm text-muted-foreground">{c.detail}</p>
            </CardContent>
          </Card>
        ))}
      </section>
      <Card>
        <CardHeader>
          <CardTitle className={headingClass}>The numbers</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <p>
            <span className={metaClass}>Live sessions</span> {health.live_sessions}
          </p>
          <p>
            <span className={metaClass}>Players ever recorded</span> {health.participants}
          </p>
          <p>
            <span className={metaClass}>Anonymous logins</span> {health.anonymous_users}{" "}
            <span className="text-muted-foreground">(clean up occasionally, see the README)</span>
          </p>
          <p>
            <span className={metaClass}>Board refreshes (get_snapshot)</span>{" "}
            {snap?.calls ? `${snap.calls} so far, ${snap.mean_ms} ms on average, ${snap.max_ms} ms at worst` : "no data yet"}
          </p>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        Also worth a look: Supabase Dashboard → Reports → Realtime (connections, messages, reconnects) and Database → Query Performance. A
        session whose row lock was held for over 100 ms leaves a <code>session_lock_wait</code> line in the Postgres logs.
      </p>
    </CenteredPage>
  );
}
