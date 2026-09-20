import Link from "next/link";
import { CenteredPage } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { ctaClass } from "@/features/open-play/styles";
import { cn } from "@/lib/utils";

export default function NotFound() {
  return (
    <CenteredPage
      eyebrow="404"
      title="No court here"
      description="We couldn't find that page. Check the code on the QR poster, or head back to open play."
    >
      <Link href="/" className={cn(buttonVariants(), ctaClass)}>
        Back to open play
      </Link>
    </CenteredPage>
  );
}
