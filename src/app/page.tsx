import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CenteredPage } from "@/components/page-shell";
import { NameEntry } from "@/features/open-play/components/name-entry";
import { WaitingForSession } from "@/features/open-play/components/waiting-for-session";
import { getActiveSessionCode, getDisplayName } from "@/features/open-play/server/queries";
import { createClient } from "@/lib/supabase/server";

/**
 * The permanent QR points here. A new player gives a name first (nothing is created until they press Continue). Once
 * this browser has a login and a name, the database says which session is live: go there, or wait for one.
 */
export default async function Home() {
  const supabase = await createClient();
  // The name form may need Turnstile, which needs the per-request CSP nonce.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return <NameEntry nonce={nonce} hasSession={false} />;
  if (!(await getDisplayName(supabase))) return <NameEntry nonce={nonce} hasSession />;

  const live = await getActiveSessionCode(supabase);
  if (live) redirect(`/play/${live}`);

  return (
    <CenteredPage
      title="Badminton Queue"
      description="No open play is running right now. Keep this page open: the queue appears as soon as a session starts."
    >
      <WaitingForSession />
      <p className="text-sm text-muted-foreground">
        Staff?{" "}
        <Link href="/admin/login" className="inline-flex min-h-11 items-center px-2 underline underline-offset-4 hover:text-foreground">
          Sign in
        </Link>
      </p>
    </CenteredPage>
  );
}
