/**
 * Where a "return to" parameter may send someone after sign-in. An allow-list, not a blocklist: only
 * this app's own officer and board pages, as a relative path. Anything else (another site, `//host`,
 * `/\host`, `javascript:`, encoded tricks) is refused and the caller falls back to its default.
 */
const ALLOWED = [/^\/admin$/, /^\/admin\/sessions\/[0-9a-fA-F-]{36}$/, /^\/play\/[A-Za-z0-9]{4,12}$/];

export function safeNext(raw: string | string[] | undefined | null): string | null {
  if (typeof raw !== "string" || raw.length > 100) return null;
  return ALLOWED.some((re) => re.test(raw)) ? raw : null;
}

/** `/admin/login` with a return path, when the path is one we would honour. */
export function loginUrl(next: string) {
  const safe = safeNext(next);
  return safe && safe !== "/admin" ? `/admin/login?next=${encodeURIComponent(safe)}` : "/admin/login";
}
