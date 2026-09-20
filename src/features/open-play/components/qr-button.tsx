"use client";

import { QRCodeCanvas, QRCodeSVG } from "qrcode.react";
import { useRef, useState } from "react";

/**
 * Small QR that opens full-screen-sized on tap, so it can be scanned from across a table.
 * It always points at the site root, which sends players to whichever session is live, so one printed QR serves every night.
 */
/** `placeholder`: show a plain icon on the button and draw the real code only in the dialog (the header button is tiny). */
export function QrButton({
  url,
  size = 88,
  downloadable = false,
  placeholder = false,
}: {
  url?: string;
  size?: number;
  downloadable?: boolean;
  placeholder?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [href, setHref] = useState(url ?? "");
  const [opened, setOpened] = useState(false);

  function open() {
    setOpened(true);
    // Resolve the origin on the client so callers don't need to know it.
    if (!url) setHref(window.location.origin);
    dialog.current?.showModal();
  }

  function download() {
    const link = document.createElement("a");
    link.href = canvas.current?.toDataURL("image/png") ?? "";
    link.download = "join-qr.png";
    link.click();
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-label="Show QR code to join"
        className="cursor-zoom-in rounded-xl bg-white p-2 transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {url && !placeholder ? <QRCodeSVG value={url} size={size} /> : <QrPlaceholder size={size} />}
      </button>
      {/* Escape closes a modal <dialog> natively; clicking the backdrop is just a pointer shortcut. */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: see above */}
      <dialog
        ref={dialog}
        onClick={(e) => e.target === dialog.current && dialog.current?.close()}
        className="m-auto w-[min(92vw,30rem)] rounded-3xl bg-white p-6 text-center text-ink backdrop:bg-black/70"
      >
        <p className="font-mono text-sm tracking-caps uppercase">Scan to join</p>
        {href && <QRCodeSVG value={href} className="mx-auto my-5 h-auto w-full" size={512} />}
        <p className="mb-5 text-sm wrap-anywhere text-ink-2">{href}</p>
        {/* A print-sized copy of the code, drawn only once the dialog has been opened. */}
        {downloadable && opened && href && <QRCodeCanvas ref={canvas} value={href} size={1024} marginSize={4} hidden />}
        <div className="flex gap-3">
          {downloadable && (
            <button type="button" onClick={download} className="h-12 flex-1 rounded-xl bg-ink text-base font-bold text-white">
              Download PNG
            </button>
          )}
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className="h-12 flex-1 rounded-xl bg-ink text-base font-bold text-white"
          >
            Close
          </button>
        </div>
      </dialog>
    </>
  );
}

function QrPlaceholder({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-ink" aria-hidden>
      <path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM19 14h2v2h-2zM14 19h2v2h-2zM19 19h2v2h-2z" />
    </svg>
  );
}
