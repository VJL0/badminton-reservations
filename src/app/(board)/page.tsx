import { headers } from "next/headers";
import Link from "next/link";
import { CenteredPage } from "@/components/page-shell";
import { LiveBoard } from "@/features/open-play/components/live-board";
import { NameEntry } from "@/features/open-play/components/name-entry";
import { WaitingForSession } from "@/features/open-play/components/waiting-for-session";
import type { Snapshot } from "@/features/open-play/types";
import { hasStaffSession } from "@/lib/staff-session";
import { getActiveSessionCode } from "@/lib/supabase/active-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

function Waiting() {
  return (
    <CenteredPage
      title="Badminton Queue"
      description="No open play is running right now. Keep this page open: the queue appears as soon as a session starts."
    >
      <WaitingForSession />
      <p className="text-sm text-muted-foreground">
        Staff?{" "}
        <Link href="/admin" className="inline-flex min-h-11 items-center px-2 underline underline-offset-4 hover:text-foreground">
          Sign in
        </Link>
      </p>
    </CenteredPage>
  );
}

/** The live session's board. Only one session is live at a time; the QR poster points here. */
export default async function Home() {
  const supabase = await createClient();
  const [code, isStaff, { data: claims }] = await Promise.all([
    getActiveSessionCode(supabase),
    hasStaffSession(),
    supabase.auth.getClaims(),
  ]);
  if (!code) return <Waiting />;

  const nonce = (await headers()).get("x-nonce") ?? undefined;
  // Staff use the staff cookie, not a Supabase session.
  if (!claims?.claims && !isStaff) return <NameEntry sessionCode={code} nonce={nonce} />;

  const { data, error } = isStaff
    ? await createAdminClient().rpc("get_snapshot", { p_code: code })
    : await supabase.rpc("get_snapshot", { p_code: code });
  if (error) throw new Error(`get_snapshot failed: ${error.message}`);
  if (!data) return <Waiting />; // deleted between the two reads
  const snapshot = data as Snapshot;
  if (!snapshot.me.display_name && !isStaff) return <NameEntry sessionCode={code} nonce={nonce} />;

  // Keyed so a new session doesn't reuse the old board's state.
  return <LiveBoard key={snapshot.session.id} initial={snapshot} isStaff={isStaff} />;
}
