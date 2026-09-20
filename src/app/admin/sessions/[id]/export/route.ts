import { idSchema } from "@/features/open-play/schemas";
import { getIdentity } from "@/features/open-play/server/auth";
import { getSessionSummary } from "@/features/open-play/server/queries";
import { csvCell } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

// One row per player, for the club's own records (attendance, participation). Officers only: the
// database refuses anyone else, and a missing or wrong session id is a plain 404.
export async function GET(_request: Request, ctx: RouteContext<"/admin/sessions/[id]/export">) {
  const id = idSchema.safeParse((await ctx.params).id);
  if (!id.success) return new Response("Not found", { status: 404 });

  const me = await getIdentity();
  if (!me) return new Response("Sign in first", { status: 401 });
  if (!me.role) return new Response("Forbidden", { status: 403 });

  const summary = await getSessionSummary(await createClient(), id.data).catch(() => undefined);
  if (summary === undefined) return new Response("Something went wrong", { status: 500 });
  if (!summary) return new Response("Not found", { status: 404 });
  const { session, players } = summary;

  const min = (s: number | null) => (s === null ? "" : (s / 60).toFixed(1));
  const rows = [
    ["Player", "Games", "Minutes playing", "Minutes waiting", "Longest wait (min)", "First seen", "Last seen", "Here for (min)", "Flags"],
    ...players.map((p) => [
      p.name,
      p.games,
      min(p.playing_s),
      min(p.waiting_s),
      min(p.longest_wait_s),
      p.first_seen,
      p.last_seen,
      min(p.present_s),
      p.flags.join(" "),
    ]),
  ];
  const csv = `${rows.map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
  const day = session.started_at.slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${session.code}-${day}-players.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
