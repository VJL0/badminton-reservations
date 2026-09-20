"use client";

import "./globals.css";

// Replaces the root layout when it throws, so it must render its own <html> and <body>.
export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body className="bg-background text-foreground">
        <title>Something went wrong</title>
        <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
          <h1 className="font-extrabold text-5xl uppercase leading-display">Foul ball</h1>
          <p className="text-muted-foreground text-sm">Something went wrong loading the app. Try again.</p>
          <button
            type="button"
            onClick={() => retry()}
            className="h-14 rounded-full bg-primary px-8 font-extrabold text-primary-foreground text-xl uppercase"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
