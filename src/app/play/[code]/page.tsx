import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { LiveBoard } from "@/features/open-play/components/live-board";
import { NameEntry } from "@/features/open-play/components/name-entry";
import { sessionCodeSchema } from "@/features/open-play/schemas";
import type { Snapshot } from "@/features/open-play/types";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata({ params }: PageProps<"/play/[code]">): Promise<Metadata> {
  const code = sessionCodeSchema.safeParse((await params).code);
  return { title: code.success ? `Open play ${code.data}` : "Open play" };
}

export default async function PlayPage({ params }: PageProps<"/play/[code]">) {
  const parsed = sessionCodeSchema.safeParse((await params).code);
  if (!parsed.success) notFound();
  const code = parsed.data;
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return <NameEntry sessionCode={code} nonce={nonce} />;

  const { data, error } = await supabase.rpc("get_snapshot", { p_code: code });
  if (error) throw new Error(`get_snapshot failed: ${error.message}`); // -> error.tsx, not a misleading 404
  if (!data) notFound();
  const snapshot = data as Snapshot;
  if (!snapshot.me.display_name) return <NameEntry sessionCode={code} nonce={nonce} />;

  return <LiveBoard initial={snapshot} />;
}
