"use client";

import { useEffect } from "react";
import { CenteredPage } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { ctaClass } from "@/features/open-play/styles";

export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <CenteredPage
      eyebrow="Something broke"
      title="Foul ball"
      description="We couldn't load this page. Your place in the queue is safe. Try again."
    >
      <Button className={ctaClass} onClick={() => retry()}>
        Try again
      </Button>
    </CenteredPage>
  );
}
