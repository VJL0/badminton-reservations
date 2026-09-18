import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function PlayerSlot({ name, isMe, onRemove }: { name?: string; isMe?: boolean; onRemove?: () => void }) {
  return (
    <div className={cn("tok", !name ? "empty" : isMe ? "me" : "")}>
      <span className="av">{name ? name.charAt(0).toUpperCase() : "+"}</span>
      <span className="nm">{name ?? "Open"}</span>
      {onRemove && !isMe && (
        <Button
          variant="destructive"
          size="icon-xs"
          className="absolute -right-1.5 -top-1.5 size-5 bg-signal text-white hover:bg-signal/90"
          onClick={onRemove}
          aria-label={`Remove ${name}`}
        >
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2.5} />
        </Button>
      )}
    </div>
  );
}
