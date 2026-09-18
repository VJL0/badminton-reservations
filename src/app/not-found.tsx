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
      description="That session code doesn't match an open play session. Check the code on the QR poster."
    >
      <Link href="/" className={cn(buttonVariants(), ctaClass)}>
        Enter a code
      </Link>
    </CenteredPage>
  );
}
