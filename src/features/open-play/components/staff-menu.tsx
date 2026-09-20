"use client";

import { Menu } from "@base-ui/react/menu";
import Link from "next/link";
import { signOut } from "../actions/admin";

const item =
  "flex min-h-11 w-full cursor-pointer items-center rounded-lg px-3 py-2.5 text-left text-sm font-semibold outline-none data-[highlighted]:bg-ink/10";

/** Account menu for signed-in staff: the name in the header opens links to the console and sign out. */
export function StaffMenu({ name, role }: { name: string | null; role: string }) {
  const initial = (name?.trim()[0] ?? "?").toUpperCase();
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={`Staff menu for ${name ?? "you"}`}
        className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-2 rounded-xl p-1 text-right outline-none hover:bg-ink/5 focus-visible:ring-2 focus-visible:ring-mat data-[popup-open]:bg-ink/10 lg:px-2"
      >
        <span className="hidden flex-col items-end gap-0.5 lg:flex">
          <span className="text-base font-bold">{name}</span>
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-2">{role.toLowerCase()}</span>
        </span>
        <span aria-hidden className="flex size-9 items-center justify-center rounded-full bg-ink text-sm font-bold text-white">
          {initial}
        </span>
        <svg
          aria-hidden
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="hidden text-ink-2 lg:block"
        >
          <path d="m3 4.5 3 3 3-3" />
        </svg>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="end" sideOffset={8} className="z-50">
          <Menu.Popup className="min-w-48 rounded-xl border bg-white p-1.5 text-ink shadow-lg outline-none">
            <div className="px-3 pb-1.5 pt-1 lg:hidden">
              <p className="text-sm font-bold">{name}</p>
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-2">{role.toLowerCase()}</p>
            </div>
            <Menu.LinkItem render={<Link href="/admin" />} className={item}>
              Officer console
            </Menu.LinkItem>
            {/* A real form so sign out works even before hydration; keep the menu mounted until it submits. */}
            <form action={signOut}>
              <Menu.Item nativeButton render={<button type="submit" />} closeOnClick={false} className={item}>
                Sign out
              </Menu.Item>
            </form>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
