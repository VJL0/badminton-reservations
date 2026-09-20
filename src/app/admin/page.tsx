import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CenteredPage } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { signOut } from "@/features/open-play/actions/admin";
import { ShuttleIcon } from "@/features/open-play/components/shuttle-icon";
import { headingClass, metaClass } from "@/features/open-play/styles";
import { createClient } from "@/lib/supabase/server";
import {
  AddAdminForm,
  ChangePasswordForm,
  CreateSessionForm,
  DeleteSessionButton,
  EndSessionButton,
  ResetPasswordButton,
  SessionQr,
} from "./admin-client";

export const metadata: Metadata = { title: "Officer console" };

type SessionRow = {
  id: string;
  code: string;
  name: string;
  status: "ACTIVE" | "ENDED";
  courts: number;
  players: number;
};

type StaffRow = {
  user_id: string;
  email: string;
  role: "ADMIN" | "OPERATOR";
  last_sign_in_at: string | null;
};

/** One session: the live one (QR, End) or an ended one (Delete, admins only). */
function SessionCard({ session, origin, canDelete }: { session: SessionRow; origin: string; canDelete: boolean }) {
  const live = session.status === "ACTIVE";
  const linkClass = "inline-flex min-h-11 items-center px-1 underline underline-offset-4";
  return (
    <Card className={live ? "border-mat" : undefined}>
      <CardContent className="flex flex-wrap items-center gap-4">
        {live && <SessionQr url={`${origin}/play/${session.code}`} code={session.code} />}
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
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) redirect("/admin/login");

  const { data, error } = await supabase.rpc("list_sessions");
  if (error) {
    if (error.message !== "not_staff") throw new Error(`list_sessions failed: ${error.message}`);
    // A player (anonymous session) who wandered here just needs to sign in as an officer.
    if (claims.claims.is_anonymous) redirect("/admin/login");
    return (
      <CenteredPage eyebrow="Officers" title="Not authorized" description="This account isn't an officer yet. Ask an admin to add you.">
        <SignOut variant="outline" />
      </CenteredPage>
    );
  }

  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const sessions = data as SessionRow[];
  // The database allows one live session at a time (list_sessions is newest first).
  const live = sessions.find((s) => s.status === "ACTIVE");
  const past = sessions.filter((s) => s !== live);
  const myId = claims.claims.sub;
  const mustChangePassword = claims.claims.app_metadata?.must_change_password === true;
  // list_staff is admin-only; an officer just doesn't get the section.
  const { data: staffData } = await supabase.rpc("list_staff");
  const staff = staffData as StaffRow[] | null;

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

      {mustChangePassword && (
        <Card className="border-signal">
          <CardHeader>
            <CardTitle className={headingClass}>Set your own password</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              You&apos;re signed in with the shared default password. Choose your own before you do anything else.
            </p>
            <ChangePasswordForm />
          </CardContent>
        </Card>
      )}

      {live ? (
        <section aria-label="Live session">
          <SessionCard session={live} origin={origin} canDelete={false} />
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
            <SessionCard key={s.id} session={s} origin={origin} canDelete={!!staff} />
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
                    {m.email}
                    {m.user_id === myId && <span className="text-muted-foreground"> (you)</span>}
                  </p>
                  <p className={metaClass}>
                    {m.role.toLowerCase()} · {m.last_sign_in_at ? "has signed in" : "never signed in"}
                  </p>
                </div>
                {m.user_id !== myId && <ResetPasswordButton userId={m.user_id} />}
              </CardContent>
            </Card>
          ))}
          <Card>
            <CardHeader>
              <CardTitle className="font-display text-2xl font-extrabold tracking-display uppercase">Add admin</CardTitle>
            </CardHeader>
            <CardContent>
              <AddAdminForm />
            </CardContent>
          </Card>
          {!mustChangePassword && (
            <Card>
              <CardHeader>
                <CardTitle className="font-display text-2xl font-extrabold tracking-display uppercase">Change my password</CardTitle>
              </CardHeader>
              <CardContent>
                <ChangePasswordForm />
              </CardContent>
            </Card>
          )}
        </section>
      )}
    </main>
  );
}
