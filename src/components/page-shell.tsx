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
        {eyebrow && <p className="font-mono text-xs font-medium tracking-caps text-mat uppercase">{eyebrow}</p>}
        <h1 className="font-display text-5xl leading-display font-extrabold text-balance uppercase">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </main>
  );
}
