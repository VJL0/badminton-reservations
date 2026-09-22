import Link from "next/link";
import { connection } from "next/server";
import { CenteredPage } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { ctaClass } from "@/features/open-play/styles";
import { cn } from "@/lib/utils";

export default async function NotFound() {
  // Render per request so scripts get the CSP nonce.
  await connection();

  return (
    <CenteredPage eyebrow="404" title="No court here" description="We couldn't find that page. Head back to open play.">
      <Link href="/" className={cn(buttonVariants(), ctaClass)}>
        Back to open play
      </Link>
    </CenteredPage>
  );
}
