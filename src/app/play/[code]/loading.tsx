import { Skeleton } from "@/components/ui/skeleton";

// Same silhouette as the live board so the page doesn't jump when it arrives.
export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-[1360px] flex-col gap-5 px-4 pt-5 lg:gap-7 lg:px-14 lg:pt-10" aria-busy="true">
      <Skeleton className="h-12 w-64 rounded-xl" />
      <Skeleton className="h-36 rounded-tile lg:h-40 lg:rounded-panel" />
      <div className="grid gap-4 lg:grid-cols-3">
        {[1, 2, 3].map((n) => (
          <Skeleton key={n} className="h-64 rounded-panel lg:h-[560px]" />
        ))}
      </div>
    </main>
  );
}
