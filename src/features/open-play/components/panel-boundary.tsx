"use client";

import { catchError, type ErrorInfo } from "next/error";
import { Button } from "@/components/ui/button";

function Fallback({ label }: { label: string }, { retry }: ErrorInfo) {
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-[20px] border-2 border-ink/15 bg-white px-4 py-3">
      <p className="text-sm font-semibold">{label} couldn&apos;t load.</p>
      <Button variant="outline" className="h-11 w-fit px-5" onClick={() => retry()}>
        Try again
      </Button>
    </div>
  );
}

/**
 * Wraps a secondary panel so a bug in it shows a small "try again" instead of taking down the whole live
 * board (the court board is what people are watching). Unlike a hand-rolled React error boundary, `catchError`
 * lets redirect()/notFound() through, can re-fetch server data on retry, and clears itself when you navigate.
 */
export const PanelBoundary = catchError(Fallback);
