"use client";

import { Popover } from "@base-ui/react/popover";
import { Notification01Icon, NotificationBlock01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { AlertSettings, type Push } from "./alert-settings";
import { PanelBoundary } from "./panel-boundary";

const PROMPT_KEY = "open-play-alerts-prompt-dismissed";
const listeners = new Set<() => void>();
let dismissedInMemory = false; // storage blocked (private window): still respected for this visit

function promptDismissed() {
  try {
    return localStorage.getItem(PROMPT_KEY) === "1";
  } catch {
    return dismissedInMemory;
  }
}
function dismissPrompt() {
  dismissedInMemory = true;
  try {
    localStorage.setItem(PROMPT_KEY, "1");
  } catch {
    /* not persisted */
  }
  for (const l of listeners) l();
}
function subscribePrompt(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

type Alerts = { enabled: boolean; set: (on: boolean) => void; preview: () => void; canVibrate: boolean };

/** Whether any way of being alerted is on: the page sound, or phone notifications. */
export const alertsOn = (alerts: Alerts, push: Push) => alerts.enabled || push.state === "on";

/** The header bell: filled when alerts are on, outlined with an amber dot when they are not. It opens the alert controls. */
export function AlertsMenu({
  alerts,
  push,
  open,
  onOpenChange,
}: {
  alerts: Alerts;
  push: Push;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const on = alertsOn(alerts, push);
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (next) dismissPrompt(); // they found the controls: the first-visit prompt has done its job
      }}
    >
      <Popover.Trigger
        aria-label={on ? "Alerts are on" : "Alerts are off"}
        className={cn(
          "relative flex size-11 cursor-pointer items-center justify-center rounded-xl outline-hidden focus-visible:ring-2 focus-visible:ring-mat data-popup-open:bg-ink/10",
          on ? "text-mat" : "text-ink-2 hover:bg-ink/5",
        )}
      >
        <HugeiconsIcon icon={on ? Notification01Icon : NotificationBlock01Icon} size={24} strokeWidth={2} />
        {!on && <span aria-hidden className="absolute top-2 right-2 size-2 rounded-full bg-cork" />}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner align="end" sideOffset={8} className="z-50">
          <Popover.Popup className="w-[min(calc(100vw-2rem),22rem)] rounded-xl border bg-white p-4 text-ink shadow-lg outline-hidden">
            <Popover.Title className="mb-3 font-mono text-caption tracking-caps text-ink-2 uppercase">Alerts</Popover.Title>
            <PanelBoundary label="Alerts">
              <AlertSettings
                sound={alerts.enabled}
                onSound={alerts.set}
                onTry={alerts.preview}
                canVibrate={alerts.canVibrate}
                push={push}
              />
            </PanelBoundary>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** One line under the header for players who have never touched alerts, pointing at the bell. Goes away for good once dismissed or used. */
export function AlertsPrompt({ alerts, push, onOpen }: { alerts: Alerts; push: Push; onOpen: () => void }) {
  const dismissed = useSyncExternalStore(subscribePrompt, promptDismissed, () => true);
  if (dismissed || alertsOn(alerts, push)) return null;
  return (
    <div className="flex items-center justify-between gap-3 rounded-card border-2 border-ink/15 bg-white px-4 py-2">
      <p className="text-sm font-semibold">Get alerted when you&apos;re up next</p>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => {
            dismissPrompt();
            onOpen();
          }}
          className="min-h-11 cursor-pointer rounded-lg px-3 text-sm font-bold text-mat hover:bg-ink/5"
        >
          Set up
        </button>
        <button
          type="button"
          onClick={dismissPrompt}
          aria-label="Dismiss"
          className="min-h-11 min-w-11 cursor-pointer rounded-lg text-ink-2 hover:bg-ink/5"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
