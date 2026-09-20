import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CenteredPage } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { signOut } from "@/features/open-play/actions/admin";
import { ShuttleIcon } from "@/features/open-play/components/shuttle-icon";
import type { SessionRow } from "@/features/open-play/schemas";
import { getIdentity } from "@/features/open-play/server/auth";
import { listSessions, listStaff } from "@/features/open-play/server/queries";
import { headingClass, metaClass } from "@/features/open-play/styles";
import { serverEnv } from "@/lib/env.server";
import { createClient } from "@/lib/supabase/server";
import {
  ChangePasswordForm,
  CreateSessionForm,
  DeleteSessionButton,
  EndSessionButton,
  InviteAdminForm,
  JoinQr,
  ResendInviteButton,
} from "./admin-client";

export const metadata: Metadata = { title: "Officer console" };

/** One session: the live one (End) or an ended one (Delete, admins only). */
function SessionCard({ session, canDelete }: { session: SessionRow; canDelete: boolean }) {
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
        {live ? <EndSessionButton sessionId={session.id} /> : canDelete && <DeleteSessionButton sessionId={session.id} />}
      </CardContent>
    </Card>
  );
}

function SignOut({ variant = "ghost" }: { variant?: "ghost" | "outline" }) {
  return (
    <form action={signOut}>
      <Button type="submit" variant={variant} size="sm">
        Sign out
      </Button>
    </form>
  );
}

export default async function AdminPage() {
  const me = await getIdentity();
  if (!me) redirect("/admin/login");
  if (!me.role) {
    // A player (anonymous session) who wandered here just needs to sign in as an officer.
    if (me.anonymous) redirect("/admin/login");
    return (
      <CenteredPage eyebrow="Officers" title="Not authorized" description="This account isn't an officer yet. Ask an admin to add you.">
        <SignOut variant="outline" />
      </CenteredPage>
    );
  }

  const supabase = await createClient();
  const sessions = await listSessions(supabase);
  // The database allows one live session at a time (list_sessions is newest first).
  const live = sessions.find((s) => s.status === "ACTIVE");
  const past = sessions.filter((s) => s !== live);
  // The roster is for admins; an officer just doesn't get the section.
  const staff = me.role === "ADMIN" ? await listStaff(supabase) : null;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 lg:gap-8 lg:px-8 lg:py-10">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <ShuttleIcon size={36} />
          <div className="flex flex-col gap-1">
            <p className="font-display text-2xl leading-display font-extrabold tracking-display uppercase">Officer console</p>
            <p className="font-mono text-caption tracking-caps text-muted-foreground uppercase">Open play</p>
          </div>
        </div>
        <SignOut />
      </header>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-4">
          <JoinQr url={serverEnv.APP_URL} />
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
          <SessionCard session={live} canDelete={false} />
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
            <SessionCard key={s.id} session={s} canDelete={!!staff} />
          ))}
        </section>
      )}

      {staff && (
        <section aria-label="Admins" className="flex flex-col gap-3">
          <h2 className={headingClass}>Admins</h2>
          {staff.map((m) => (
            <Card key={m.user_id}>
              <CardContent className="flex flex-wrap items-center gap-4">
                <div className="flex min-w-48 flex-1 flex-col gap-1">
                  <p className="font-semibold wrap-anywhere">
                    {m.email ?? "(no email)"}
                    {m.user_id === me.id && <span className="text-muted-foreground"> (you)</span>}
                  </p>
                  <p className={metaClass}>
                    {m.role.toLowerCase()} · {m.last_sign_in_at ? "has signed in" : "invited, not signed in yet"}
                  </p>
                </div>
                {!m.last_sign_in_at && m.email && <ResendInviteButton userId={m.user_id} />}
              </CardContent>
            </Card>
          ))}
          <Card>
            <CardHeader>
              <CardTitle className="font-display text-2xl font-extrabold tracking-display uppercase">Invite an admin</CardTitle>
            </CardHeader>
            <CardContent>
              <InviteAdminForm />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="font-display text-2xl font-extrabold tracking-display uppercase">Change my password</CardTitle>
            </CardHeader>
            <CardContent>
              <ChangePasswordForm />
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground">
            <Link href="/admin/health" className="underline underline-offset-4">
              System health
            </Link>{" "}
            shows the notification queue, the timers and how the database is coping.
          </p>
        </section>
      )}
    </main>
  );
}
