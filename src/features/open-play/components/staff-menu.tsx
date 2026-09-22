"use client";

import { Menu } from "@base-ui/react/menu";
import Link from "next/link";
import { staffSignOut } from "../actions/staff-auth";

const item =
  "flex min-h-11 w-full cursor-pointer items-center rounded-lg px-3 py-2.5 text-left text-sm font-semibold outline-hidden data-highlighted:bg-ink/10";

/** Menu for anyone signed in with the staff code: every staff member has the same permissions, so there's no per-person identity to show. */
export function StaffMenu() {
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label="Staff menu"
        className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-2 rounded-xl p-1 text-right outline-hidden hover:bg-ink/5 focus-visible:ring-2 focus-visible:ring-mat data-popup-open:bg-ink/10 lg:px-2"
      >
        <span className="hidden font-mono text-caption tracking-caps text-ink-2 uppercase lg:flex">Staff</span>
        <span aria-hidden className="flex size-9 items-center justify-center rounded-full bg-ink text-sm font-bold text-white">
          ★
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
          <Menu.Popup className="min-w-48 rounded-xl border bg-white p-1.5 text-ink shadow-lg outline-hidden">
            <div className="px-3 pt-1 pb-1.5 lg:hidden">
              <p className="font-mono text-caption tracking-caps text-ink-2 uppercase">Staff</p>
            </div>
            <Menu.LinkItem render={<Link href="/admin" />} className={item}>
              Staff console
            </Menu.LinkItem>
            {/* A real form so sign out works even before hydration; keep the menu mounted until it submits. */}
            <form action={staffSignOut}>
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
