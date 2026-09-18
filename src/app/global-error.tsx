"use client";

import "./globals.css";

// Replaces the root layout when it throws, so it must render its own <html> and <body>.
export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body className="bg-background text-foreground">
        <title>Something went wrong</title>
        <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
          <h1 className="text-5xl font-extrabold uppercase leading-[0.9]">Foul ball</h1>
          <p className="text-sm text-muted-foreground">Something went wrong loading the app. Try again.</p>
          <button
            onClick={() => retry()}
            className="h-14 rounded-full bg-primary px-8 text-xl font-extrabold uppercase text-primary-foreground"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
