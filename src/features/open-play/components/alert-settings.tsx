"use client";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { usePush } from "../hooks/use-push";

/** Player-facing alert choices: sound + vibration while the page is open, notifications when it isn't. */
export function AlertSettings({ sound, onSound, canVibrate }: { sound: boolean; onSound: (on: boolean) => void; canVibrate: boolean }) {
  const push = usePush();

  return (
    <section aria-label="Alerts" className="flex flex-col gap-3 rounded-[20px] border-2 border-ink/15 bg-white px-4 py-3 lg:flex-row lg:items-center lg:justify-between lg:px-6">
      <label className="flex min-h-11 items-center gap-3">
        <Switch checked={sound} onCheckedChange={onSound} />
        <span className="text-sm font-semibold">
          Sound{canVibrate ? " and vibration" : ""} when it&apos;s your turn
          <span className="block text-xs font-normal text-ink-2">While this page is open. Tap to preview.</span>
        </span>
      </label>

      {push.state !== "hidden" && (
        <div className="flex flex-col gap-1 lg:items-end">
          {push.state === "off" && (
            <Button className="h-11 px-5" disabled={push.busy} onClick={push.enable}>
              Notify me when I&apos;m up
            </Button>
          )}
          {push.state === "on" && (
            <Button variant="outline" className="h-11 px-5" disabled={push.busy} onClick={push.disable}>
              Notifications on · Turn off
            </Button>
          )}
          {push.state === "needs-install" && (
            <p className="max-w-xs text-xs text-ink-2">
              To get notifications on iPhone, tap Share, then &ldquo;Add to Home Screen&rdquo;, and open the app from there.
            </p>
          )}
          {push.state === "denied" && (
            <p className="max-w-xs text-xs text-ink-2">Notifications are blocked. Allow them for this site in your browser settings.</p>
          )}
          {push.state === "unsupported" && <p className="max-w-xs text-xs text-ink-2">This browser can&apos;t send notifications.</p>}
          {push.error && <p role="alert" className="text-xs text-destructive">{push.error}</p>}
        </div>
      )}
    </section>
  );
}
