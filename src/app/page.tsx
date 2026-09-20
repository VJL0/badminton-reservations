import Link from "next/link";
import { redirect } from "next/navigation";
import { CenteredPage } from "@/components/page-shell";
import { getActiveSessionCode } from "@/lib/supabase/active-session";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  // The QR poster points here permanently: send players to the session that is live.
  const live = await getActiveSessionCode(await createClient());
  if (live) redirect(`/play/${live}`);

  return (
    <CenteredPage title="Badminton Queue" description="No open play is running right now. Scan the poster's QR code again once it starts.">
      <p className="text-sm text-muted-foreground">
        Staff?{" "}
        <Link href="/admin/login" className="inline-flex min-h-11 items-center px-2 underline underline-offset-4 hover:text-foreground">
          Sign in
        </Link>
      </p>
    </CenteredPage>
  );
}
