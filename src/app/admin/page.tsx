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
import { headingClass } from "@/features/open-play/styles";
import { createClient } from "@/lib/supabase/server";
import { AddAdminForm, ChangePasswordForm, CreateSessionForm, EndSessionButton, ResetPasswordButton, SessionQr } from "./admin-client";

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
            <p className="font-display text-2xl font-extrabold uppercase leading-[0.9] tracking-[0.03em]">Officer console</p>
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Open play sessions</p>
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

      <Card>
        <CardHeader>
          <CardTitle className={headingClass}>New session</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateSessionForm />
        </CardContent>
      </Card>

      <section aria-label="Sessions" className="flex flex-col gap-3">
        {sessions.length === 0 && <p className="text-muted-foreground">No sessions yet.</p>}
        {sessions.map((s) => (
          <Card key={s.id}>
            <CardContent className="flex flex-wrap items-center gap-4">
              {s.status === "ACTIVE" && <SessionQr url={`${origin}/play/${s.code}`} code={s.code} />}
              <div className="flex min-w-[10rem] flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-x-2">
                  <h2 className="break-words font-display text-2xl font-extrabold uppercase tracking-[0.03em]">{s.name}</h2>
                  <Badge
                    className={s.status === "ACTIVE" ? "bg-mat text-white" : ""}
                    variant={s.status === "ACTIVE" ? "default" : "secondary"}
                  >
                    {s.status === "ACTIVE" ? "Live" : "Ended"}
                  </Badge>
                </div>
                <p className="font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">
                  /play/{s.code} · {s.courts} courts · {s.players} players
                </p>
                <nav aria-label={`${s.name} links`} className="-mx-1 flex flex-wrap font-mono text-xs uppercase tracking-[0.1em]">
                  {s.status === "ACTIVE" && (
                    <a className="inline-flex min-h-11 items-center px-1 underline underline-offset-4" href={`/play/${s.code}`}>
                      Live board &amp; settings
                    </a>
                  )}
                  <Link className="inline-flex min-h-11 items-center px-1 underline underline-offset-4" href={`/admin/sessions/${s.id}`}>
                    Details
                  </Link>
                </nav>
              </div>
              {s.status === "ACTIVE" && <EndSessionButton sessionId={s.id} />}
            </CardContent>
          </Card>
        ))}
      </section>

      {staff && (
        <section aria-label="Admins" className="flex flex-col gap-3">
          <h2 className={headingClass}>Admins</h2>
          {staff.map((m) => (
            <Card key={m.user_id}>
              <CardContent className="flex flex-wrap items-center gap-4">
                <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
                  <p className="break-all font-semibold">
                    {m.email}
                    {m.user_id === myId && <span className="text-muted-foreground"> (you)</span>}
                  </p>
                  <p className="font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">
                    {m.role.toLowerCase()} · {m.last_sign_in_at ? "has signed in" : "never signed in"}
                  </p>
                </div>
                {m.user_id !== myId && <ResetPasswordButton userId={m.user_id} />}
              </CardContent>
            </Card>
          ))}
          <Card>
            <CardHeader>
              <CardTitle className="font-display text-2xl font-extrabold uppercase tracking-[0.03em]">Add admin</CardTitle>
            </CardHeader>
            <CardContent>
              <AddAdminForm />
            </CardContent>
          </Card>
          {!mustChangePassword && (
            <Card>
              <CardHeader>
                <CardTitle className="font-display text-2xl font-extrabold uppercase tracking-[0.03em]">Change my password</CardTitle>
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
