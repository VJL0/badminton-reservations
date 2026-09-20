import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LocalTime } from "@/components/local-time";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { idSchema } from "@/features/open-play/schemas";
import { loginUrl } from "@/lib/redirects";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Session details" };

type Details = {
  session: {
    id: string;
    code: string;
    name: string;
    status: "ACTIVE" | "ENDED";
    game_duration_seconds: number;
    auto_requeue_on_finish: boolean;
    auto_start: boolean;
    start_delay_seconds: number;
    started_at: string;
    ended_at: string | null;
    courts: number;
  };
  players: { player_id: string; name: string; joined_at: string; state: "IDLE" | "QUEUED" | "PLAYING"; games: number }[];
  rounds: { id: string; court_number: number; status: string; started_at: string; ended_at: string | null; players: string[] }[];
};

const heading = "font-display text-3xl font-extrabold uppercase tracking-[0.03em]";
const meta = "font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground";

export default async function SessionDetailsPage({ params }: PageProps<"/admin/sessions/[id]">) {
  const rawId = (await params).id;
  const id = idSchema.safeParse(rawId);
  if (!id.success) redirect("/admin"); // not a session id: the list is the right page

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) redirect(loginUrl(`/admin/sessions/${id.data}`)); // sign in, then come straight back

  const { data, error } = await supabase.rpc("get_session_details", { p_session_id: id.data });
  if (error) {
    if (error.message === "not_staff") redirect("/admin");
    throw new Error(`get_session_details failed: ${error.message}`);
  }
  if (!data) redirect("/admin"); // no such session (deleted or mistyped)
  const { session, players, rounds } = data as Details;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 lg:gap-8 lg:px-8 lg:py-10">
      <header className="flex flex-col gap-2">
        <Link href="/admin" className="text-sm text-muted-foreground underline underline-offset-4">
          ← All sessions
        </Link>
        <div className="flex items-center gap-2">
          <h1 className="truncate font-display text-4xl font-extrabold uppercase tracking-[0.03em]">{session.name}</h1>
          <Badge className={session.status === "ACTIVE" ? "bg-mat text-white" : ""} variant={session.status === "ACTIVE" ? "default" : "secondary"}>
            {session.status === "ACTIVE" ? "Live" : "Ended"}
          </Badge>
        </div>
        <p className={meta}>
          {session.code} · {session.courts} courts · {Math.round(session.game_duration_seconds / 60)}-minute games
          {session.auto_start ? ` · auto-start${session.start_delay_seconds ? ` after ${session.start_delay_seconds}s` : ""}` : " · manual start"}
          {session.auto_requeue_on_finish && " · auto re-queue"}
        </p>
        <p className={meta}>
          Started <LocalTime iso={session.started_at} />
          {session.ended_at && <> · Ended <LocalTime iso={session.ended_at} /></>}
        </p>
        <p className={meta}>{players.length} players · {rounds.length} games</p>
      </header>

      <Card>
        <CardHeader><CardTitle className={heading}>Players</CardTitle></CardHeader>
        <CardContent>
          {players.length === 0 && <p className="text-muted-foreground">Nobody has joined yet.</p>}
          <ul className="divide-y">
            {players.map((p) => (
              <li key={p.player_id} className="flex items-center justify-between gap-4 py-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{p.name}</p>
                  <p className={meta}>First joined <LocalTime iso={p.joined_at} part="time" /></p>
                </div>
                <p className={meta}>{p.games} {p.games === 1 ? "game" : "games"}</p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className={heading}>Games</CardTitle></CardHeader>
        <CardContent>
          {rounds.length === 0 && <p className="text-muted-foreground">No games have started yet.</p>}
          <ul className="divide-y">
            {rounds.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 py-2">
                <p className={meta}>
                  Court {r.court_number} · <LocalTime iso={r.started_at} part="time" />
                  {r.ended_at ? <> – <LocalTime iso={r.ended_at} part="time" /></> : " · in progress"}
                </p>
                <p className="font-semibold">{r.players.join(", ")}</p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </main>
  );
}
