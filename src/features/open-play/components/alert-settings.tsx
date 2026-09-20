"use client";

import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { usePush } from "../hooks/use-push";

const noop = () => () => {};
const isIPhone = () => /iPad|iPhone|iPod/.test(navigator.userAgent);

export type Push = ReturnType<typeof usePush>;

/**
 * The alert controls, shown in the header's bell popover. How a player hears it's their turn:
 *  - on this page: a sound (and a vibration on Android phones);
 *  - anywhere else: a phone notification, which carries its own sound and buzz.
 * iPhones can't vibrate a web page at all (Safari has no vibration API), so there the buzz comes only from the notification.
 */
export function AlertSettings({
  sound,
  onSound,
  onTry,
  canVibrate,
  push,
}: {
  sound: boolean;
  onSound: (on: boolean) => void;
  onTry: () => void;
  canVibrate: boolean;
  push: Push;
}) {
  const iphone = useSyncExternalStore(noop, isIPhone, () => false);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <label className="flex min-h-11 flex-1 items-center gap-3">
          <Switch checked={sound} onCheckedChange={onSound} />
          <span className="text-sm font-semibold">
            Sound{canVibrate ? " and vibration" : ""} when it&apos;s your turn
            <span className="block text-xs font-normal text-ink-2">
              While this page is open.
              {iphone ? " Plays even if your iPhone is on silent." : ""}
            </span>
          </span>
        </label>
        {sound && (
          <Button type="button" variant="outline" className="h-11 shrink-0 px-4" onClick={onTry}>
            Try it
          </Button>
        )}
      </div>

      {push.state !== "hidden" && (
        <div className="flex flex-col gap-2 border-t border-ink/10 pt-3">
          <p className="text-sm font-semibold">
            Phone notifications
            <span className="block text-xs font-normal text-ink-2">
              Reach you when the app is closed or your screen is locked.
              {iphone ? " The buzz on an iPhone comes from the notification." : ""}
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            {push.state === "off" && (
              <Button className="h-11 px-5" disabled={push.busy} onClick={push.enable}>
                Turn on notifications
              </Button>
            )}
            {push.state === "on" && (
              <>
                <Button variant="outline" className="h-11 px-5" disabled={push.busy} onClick={push.test}>
                  Send me a test
                </Button>
                <Button variant="outline" className="h-11 px-5" disabled={push.busy} onClick={push.disable}>
                  Turn off
                </Button>
              </>
            )}
          </div>
          {push.state === "needs-install" && (
            <p className="text-xs text-ink-2">On iPhone, notifications only work once the app is on your Home Screen. Steps are below.</p>
          )}
          {push.state === "denied" && (
            <p className="text-xs text-ink-2">Notifications are blocked. Allow them for this site in your browser or phone settings.</p>
          )}
          {push.state === "unsupported" && <p className="text-xs text-ink-2">This browser can&apos;t send notifications.</p>}
          {push.error && (
            <p role="alert" className="text-xs text-destructive">
              {push.error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
