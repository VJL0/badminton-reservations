"use client";

import { QRCodeSVG } from "qrcode.react";
import { useRef, useState } from "react";

/** Small QR that opens full-screen-sized on tap, so it can be scanned from across a table. */
export function QrButton({ url, code, size = 88 }: { url?: string; code: string; size?: number }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [href, setHref] = useState(url ?? "");

  function open() {
    // Resolve the origin on the client so callers don't need to know it.
    if (!url) setHref(`${window.location.origin}/play/${code}`);
    dialog.current?.showModal();
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-label={`Show QR code for session ${code}`}
        className="cursor-zoom-in rounded-xl bg-white p-2 transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {url ? <QRCodeSVG value={url} size={size} /> : <QrPlaceholder size={size} />}
      </button>
      <dialog
        ref={dialog}
        onClick={(e) => e.target === dialog.current && dialog.current?.close()}
        className="m-auto w-[min(92vw,30rem)] rounded-3xl bg-white p-6 text-center text-ink backdrop:bg-black/70"
      >
        <p className="font-mono text-sm uppercase tracking-[0.14em]">Scan to join · {code}</p>
        {href && <QRCodeSVG value={href} className="mx-auto my-5 h-auto w-full" size={512} />}
        <p className="mb-5 break-all text-sm text-ink-2">{href}</p>
        <button
          type="button"
          autoFocus
          onClick={() => dialog.current?.close()}
          className="h-12 w-full rounded-xl bg-ink text-base font-bold text-white"
        >
          Close
        </button>
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
