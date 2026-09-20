import { Skeleton } from "@/components/ui/skeleton";

// Shown at once while the officer console (several database calls) or a session summary is computed,
// so a tap on "Details" responds immediately. Same width and rhythm as the pages it stands in for.
export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 lg:gap-8 lg:px-8 lg:py-10" aria-busy="true">
      <Skeleton className="h-12 w-64 rounded-xl" />
      <div className="grid grid-cols-2 gap-3">
        {[1, 2, 3, 4].map((n) => (
          <Skeleton key={n} className="h-28 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-56 rounded-2xl" />
      <Skeleton className="h-56 rounded-2xl" />
    </main>
  );
}
