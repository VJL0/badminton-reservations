"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const TONES = {
  plain: "",
  // on the dark hall
  hall: "border-line/60 bg-transparent text-line hover:bg-line/10 hover:text-line",
  urgent: "border-transparent bg-signal text-white hover:bg-signal/90",
} as const;

/** Two-tap button: first tap arms it, second tap runs it. Guards against fat-fingering a live game. */
export function ConfirmButton({
  label,
  confirmLabel = "Tap again to confirm",
  tone = "plain",
  className,
  onConfirm,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "onClick" | "variant" | "children"> & {
  label: string;
  confirmLabel?: string;
  tone?: keyof typeof TONES;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);
  return (
    <Button
      variant="outline"
      {...props}
      className={cn("h-12 rounded-2xl text-[15px] font-semibold", armed ? TONES.urgent : TONES[tone], className)}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          setTimeout(() => setArmed(false), 3500);
        } else {
          setArmed(false);
          onConfirm();
        }
      }}
    >
      {armed ? confirmLabel : label}
    </Button>
  );
}
