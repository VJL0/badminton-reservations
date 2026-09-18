"use client";

/** Renders in the viewer's timezone; the server would otherwise format in UTC. */
export function LocalTime({ iso, part = "datetime" }: { iso: string | null; part?: "datetime" | "time" }) {
  if (!iso) return <>—</>;
  const d = new Date(iso);
  const text =
    part === "time"
      ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  return <time dateTime={iso} suppressHydrationWarning>{text}</time>;
}
