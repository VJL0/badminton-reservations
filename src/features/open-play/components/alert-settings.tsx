"use client";

import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { usePush } from "../hooks/use-push";

const noop = () => () => {};
const isIPhone = () => /iPad|iPhone|iPod/.test(navigator.userAgent);

/**
 * How a player hears it's their turn:
 *  - on this page: a sound (and a vibration on Android phones);
 *  - anywhere else: a phone notification, which carries its own sound and buzz.
 * iPhones can't vibrate a web page at all (Safari has no vibration API), so there the buzz comes only from the notification.
 */
export function AlertSettings({
  sound,
  onSound,
  onTry,
  canVibrate,
}: {
  sound: boolean;
  onSound: (on: boolean) => void;
  onTry: () => void;
  canVibrate: boolean;
}) {
  const push = usePush();
  const iphone = useSyncExternalStore(noop, isIPhone, () => false);

  return (
    <section aria-label="Alerts" className="flex flex-col gap-3 rounded-card border-2 border-ink/15 bg-white px-4 py-3 lg:px-6">
      <div className="flex items-center justify-between gap-3">
        <label className="flex min-h-11 flex-1 items-center gap-3">
          <Switch checked={sound} onCheckedChange={onSound} />
          <span className="font-semibold text-sm">
            Sound{canVibrate ? " and vibration" : ""} when it&apos;s your turn
            <span className="block font-normal text-ink-2 text-xs">
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
        <div className="flex flex-col gap-2 border-ink/10 border-t pt-3">
          <p className="font-semibold text-sm">
            Phone notifications
            <span className="block font-normal text-ink-2 text-xs">
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
            <p className="text-ink-2 text-xs">
              On iPhone, notifications only work for an app on your Home Screen. Tap Share, then &ldquo;Add to Home Screen&rdquo;, and open
              it from there.
            </p>
          )}
          {push.state === "denied" && (
            <p className="text-ink-2 text-xs">Notifications are blocked. Allow them for this site in your browser or phone settings.</p>
          )}
          {push.state === "unsupported" && <p className="text-ink-2 text-xs">This browser can&apos;t send notifications.</p>}
          {push.error && (
            <p role="alert" className="text-destructive text-xs">
              {push.error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
