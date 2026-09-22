import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import type { Database } from "./database.types";

/** Refreshes the Supabase auth cookies. Every rebuilt response must forward `requestHeaders` (CSP nonce). */
export async function updateSession(request: NextRequest, requestHeaders: Headers) {
  let response = NextResponse.next({ request: { headers: requestHeaders } });
  const supabase = createServerClient<Database>(env.SUPABASE_URL, env.SUPABASE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list, headers) {
        for (const { name, value } of list) request.cookies.set(name, value);
        requestHeaders.set("cookie", request.headers.get("cookie") ?? "");
        response = NextResponse.next({
          request: { headers: requestHeaders },
        });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
        // no-store headers, so a CDN never caches a token.
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });
  await supabase.auth.getClaims(); // refreshes the token when due
  return response;
}
