import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { LiveBoard } from "@/features/open-play/components/live-board";
import { NameEntry } from "@/features/open-play/components/name-entry";
import { sessionCodeSchema } from "@/features/open-play/schemas";
import type { Snapshot } from "@/features/open-play/types";
import { getActiveSessionCode } from "@/lib/supabase/active-session";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata({ params }: PageProps<"/play/[code]">): Promise<Metadata> {
  const code = sessionCodeSchema.safeParse((await params).code);
  return { title: code.success ? `Open play ${code.data}` : "Open play" };
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** A code that leads nowhere: take the player to tonight's session if there is one, else say so. */
async function sendToLive(supabase: Supabase, notice: "not-found" | "ended", not: string): Promise<never> {
  const live = await getActiveSessionCode(supabase);
  if (live && live !== not) redirect(`/play/${live}?notice=${notice}`);
  redirect("/");
}

export default async function PlayPage({ params, searchParams }: PageProps<"/play/[code]">) {
  const supabase = await createClient();
  const parsed = sessionCodeSchema.safeParse((await params).code);
  if (!parsed.success) return sendToLive(supabase, "not-found", "");
  const code = parsed.data;
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const noticeParam = (await searchParams).notice;
  const notice = noticeParam === "not-found" || noticeParam === "ended" ? noticeParam : undefined;

  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return <NameEntry sessionCode={code} nonce={nonce} />;

  const { data, error } = await supabase.rpc("get_snapshot", { p_code: code });
  if (error) throw new Error(`get_snapshot failed: ${error.message}`); // -> error.tsx, not a misleading 404
  if (!data) return sendToLive(supabase, "not-found", code);
  const snapshot = data as Snapshot;
  if (!snapshot.me.display_name) return <NameEntry sessionCode={code} nonce={nonce} />;

  // An ended session is a dead end for players: move them on. Officers can still open it to look.
  if (snapshot.session.status === "ENDED" && !snapshot.me.role) {
    const live = await getActiveSessionCode(supabase);
    if (live && live !== code) redirect(`/play/${live}?notice=ended`);
  }

  return <LiveBoard initial={snapshot} notice={notice} />;
}
