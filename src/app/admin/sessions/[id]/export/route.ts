import { idSchema } from "@/features/open-play/schemas";
import { csvCell } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { Summary } from "../summary-types";

// One row per player, for the club's own records (attendance, participation). Officers only: the
// database refuses anyone else, and a missing or wrong session id is a plain 404.
export async function GET(_request: Request, ctx: RouteContext<"/admin/sessions/[id]/export">) {
  const id = idSchema.safeParse((await ctx.params).id);
  if (!id.success) return new Response("Not found", { status: 404 });

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return new Response("Sign in first", { status: 401 });

  const { data, error } = await supabase.rpc("get_session_summary", { p_session_id: id.data });
  if (error) return new Response(error.message === "not_staff" ? "Forbidden" : "Something went wrong", { status: error.message === "not_staff" ? 403 : 500 });
  if (!data) return new Response("Not found", { status: 404 });
  const { session, players } = data as Summary;

  const min = (s: number | null) => (s === null ? "" : (s / 60).toFixed(1));
  const rows = [
    ["Player", "Games", "Minutes playing", "Minutes waiting", "Longest wait (min)", "First seen", "Last seen", "Here for (min)", "Flags"],
    ...players.map((p) => [p.name, p.games, min(p.playing_s), min(p.waiting_s), min(p.longest_wait_s), p.first_seen, p.last_seen, min(p.present_s), p.flags.join(" ")]),
  ];
  const csv = rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  const day = session.started_at.slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${session.code}-${day}-players.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
