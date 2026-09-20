"use client";

import { Button } from "@/components/ui/button";
import { useInstall } from "../hooks/use-install";

/** "Install the app": the browser's own prompt where there is one, Safari's Share-sheet steps on iPhone, nothing once installed. */
export function InstallApp() {
  const { state, install } = useInstall();
  if (state === "hidden") return null;
  return (
    <div className="flex flex-col gap-2 border-t border-ink/10 pt-3">
      <p className="text-sm font-semibold">
        Install the app
        <span className="block text-xs font-normal text-ink-2">
          Opens like any other app, and on iPhone it is what lets notifications through.
        </span>
      </p>
      {state === "prompt" ? (
        <Button className="h-11 w-fit px-5" onClick={install}>
          Install app
        </Button>
      ) : (
        <ol className="list-decimal pl-5 text-xs text-ink-2">
          <li>Tap the Share button in Safari&apos;s toolbar.</li>
          <li>Choose &ldquo;Add to Home Screen&rdquo;, then Add.</li>
          <li>Open the app from your Home Screen.</li>
        </ol>
      )}
    </div>
  );
}
