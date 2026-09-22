import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { staffSignOut } from "@/features/open-play/actions/staff-auth";
import { ShuttleIcon } from "@/features/open-play/components/shuttle-icon";
import { headingClass, metaClass } from "@/features/open-play/styles";
import { requireStaffSession } from "@/lib/staff-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { CreateSessionForm, DeleteSessionButton, EndSessionButton, JoinQr } from "./admin-client";

export const metadata: Metadata = { title: "Staff console" };

type SessionRow = {
  id: string;
  code: string;
  name: string;
  status: "ACTIVE" | "ENDED";
  courts: number;
  players: number;
};

/** One session: the live one (End) or an ended one (Delete). */
function SessionCard({ session }: { session: SessionRow }) {
  const live = session.status === "ACTIVE";
  const linkClass = "inline-flex min-h-11 items-center px-1 underline underline-offset-4";
  return (
    <Card className={live ? "border-mat" : undefined}>
      <CardContent className="flex flex-wrap items-center gap-4">
        <div className="flex min-w-40 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-2">
            <h3 className="font-display text-2xl font-extrabold tracking-display wrap-break-word uppercase">{session.name}</h3>
            {live && <Badge className="bg-mat text-white">Live</Badge>}
          </div>
          <p className={metaClass}>
            {session.courts} courts · {session.players} players
          </p>
          <nav aria-label={`${session.name} links`} className="-mx-1 flex flex-wrap font-mono text-xs tracking-meta uppercase">
            {live && (
              <a className={linkClass} href={`/play/${session.code}`}>
                Live board &amp; settings
              </a>
            )}
            <Link className={linkClass} href={`/admin/sessions/${session.id}`}>
              Details
            </Link>
          </nav>
        </div>
        {live ? <EndSessionButton sessionId={session.id} /> : <DeleteSessionButton sessionId={session.id} />}
      </CardContent>
    </Card>
  );
}

export default async function AdminPage() {
  await requireStaffSession();

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("list_sessions");
  if (error) throw new Error(`list_sessions failed: ${error.message}`);

  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const sessions = data as SessionRow[];
  // The database allows one live session at a time (list_sessions is newest first).
  const live = sessions.find((s) => s.status === "ACTIVE");
  const past = sessions.filter((s) => s !== live);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 lg:gap-8 lg:px-8 lg:py-10">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <ShuttleIcon size={36} />
          <div className="flex flex-col gap-1">
            <p className="font-display text-2xl leading-display font-extrabold tracking-display uppercase">Staff console</p>
            <p className="font-mono text-caption tracking-caps text-muted-foreground uppercase">Open play</p>
          </div>
        </div>
        <form action={staffSignOut}>
          <Button type="submit" variant="ghost" size="sm">
            Sign out
          </Button>
        </form>
      </header>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-4">
          <JoinQr url={origin} />
          <div className="flex min-w-40 flex-1 flex-col gap-1">
            <h2 className={headingClass}>Join QR</h2>
            <p className="text-sm text-muted-foreground">
              Print this once. It is the same every night: players who scan it land on whichever session is live.
            </p>
          </div>
        </CardContent>
      </Card>

      {live ? (
        <section aria-label="Live session">
          <SessionCard session={live} />
        </section>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className={headingClass}>Start open play</CardTitle>
          </CardHeader>
          <CardContent>
            <CreateSessionForm />
          </CardContent>
        </Card>
      )}

      {past.length > 0 && (
        <section aria-label="Past sessions" className="flex flex-col gap-3">
          <h2 className={headingClass}>Past sessions</h2>
          {past.map((s) => (
            <SessionCard key={s.id} session={s} />
          ))}
        </section>
      )}
    </main>
  );
}
