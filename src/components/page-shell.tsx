import { cn } from "@/lib/utils";

/** The narrow, vertically centered layout shared by home, name entry, sign-in, 404 and error pages. */
export function CenteredPage({
  eyebrow,
  title,
  description,
  children,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <main className={cn("mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 p-6", className)}>
      <div className="flex flex-col gap-2">
        {eyebrow && <p className="font-medium font-mono text-mat text-xs uppercase tracking-caps">{eyebrow}</p>}
        <h1 className="text-balance font-display font-extrabold text-5xl uppercase leading-display">{title}</h1>
        {description && <p className="text-muted-foreground text-sm">{description}</p>}
      </div>
      {children}
    </main>
  );
}
