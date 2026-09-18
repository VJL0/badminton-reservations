import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { CenteredPage } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { signOut } from "@/features/open-play/actions/admin";
import { ShuttleIcon } from "@/features/open-play/components/shuttle-icon";
import { createClient } from "@/lib/supabase/server";
import { CreateSessionForm, EndSessionButton, SessionQr } from "./admin-client";

export const metadata: Metadata = { title: "Officer console" };

type SessionRow = {
  id: string;
  code: string;
  name: string;
  status: "ACTIVE" | "ENDED";
  courts: number;
  players: number;
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
    return (
      <CenteredPage
        eyebrow="Officers"
        title="Not authorized"
        description="This account isn't an officer yet. Ask an admin to add you."
      >
        <SignOut variant="outline" />
      </CenteredPage>
    );
  }

  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const sessions = data as SessionRow[];

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

      <Card>
        <CardHeader>
          <CardTitle className="font-display text-3xl font-extrabold uppercase tracking-[0.03em]">New session</CardTitle>
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
              {s.status === "ACTIVE" && <SessionQr url={`${origin}/play/${s.code}`} />}
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-center gap-2">
                  <h2 className="truncate font-display text-2xl font-extrabold uppercase tracking-[0.03em]">{s.name}</h2>
                  <Badge className={s.status === "ACTIVE" ? "bg-mat text-white" : ""} variant={s.status === "ACTIVE" ? "default" : "secondary"}>
                    {s.status === "ACTIVE" ? "Live" : "Ended"}
                  </Badge>
                </div>
                <p className="font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">
                  <a className="underline underline-offset-4" href={`/play/${s.code}`}>
                    /play/{s.code}
                  </a>{" "}
                  · {s.courts} courts · {s.players} players
                </p>
              </div>
              {s.status === "ACTIVE" && <EndSessionButton sessionId={s.id} />}
            </CardContent>
          </Card>
        ))}
      </section>
    </main>
  );
}
