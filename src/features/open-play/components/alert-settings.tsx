"use client";

import { Switch } from "@/components/ui/switch";

/** Sound (and vibration where the phone allows it) when it's your turn, while this page is open. */
export function AlertSettings({ sound, onSound, canVibrate }: { sound: boolean; onSound: (on: boolean) => void; canVibrate: boolean }) {
  return (
    <section aria-label="Alerts" className="rounded-[20px] border-2 border-ink/15 bg-white px-4 py-3 lg:px-6">
      <label className="flex min-h-11 items-center gap-3">
        <Switch checked={sound} onCheckedChange={onSound} />
        <span className="text-sm font-semibold">
          Sound{canVibrate ? " and vibration" : ""} when it&apos;s your turn
          <span className="block text-xs font-normal text-ink-2">While this page is open. Tap to preview.</span>
        </span>
      </label>
    </section>
  );
}
