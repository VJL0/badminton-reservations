import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CenteredPage } from "@/components/page-shell";
import { WaitingForSession } from "@/features/open-play/components/waiting-for-session";
import { getActiveSessionCode } from "@/features/open-play/server/queries";

export default async function Home() {
  // The QR poster points here permanently: send players to the session that is live.
  const live = await getActiveSessionCode();
  if (live) redirect(`/play/${live}`);
  // The waiting screen may need Turnstile, which needs the per-request CSP nonce.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <CenteredPage
      title="Badminton Queue"
      description="No open play is running right now. Keep this page open: the queue appears as soon as a session starts."
    >
      <WaitingForSession nonce={nonce} />
      <p className="text-sm text-muted-foreground">
        Staff?{" "}
        <Link href="/admin/login" className="inline-flex min-h-11 items-center px-2 underline underline-offset-4 hover:text-foreground">
          Sign in
        </Link>
      </p>
    </CenteredPage>
  );
}
