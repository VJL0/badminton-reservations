import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import type { Database } from "./database.types";

/**
 * Keeps the Supabase auth cookies fresh. `requestHeaders` already carries the CSP nonce, so every
 * response we rebuild has to forward them (the nonce reaches Server Components via x-nonce).
 */
export async function updateSession(request: NextRequest, requestHeaders: Headers) {
  let response = NextResponse.next({ request: { headers: requestHeaders } });
  const supabase = createServerClient<Database>(env.SUPABASE_URL, env.SUPABASE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list) {
        for (const { name, value } of list) request.cookies.set(name, value);
        requestHeaders.set("cookie", request.headers.get("cookie") ?? "");
        response = NextResponse.next({ request: { headers: requestHeaders } });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  await supabase.auth.getClaims(); // verifies the JWT (locally, with asymmetric keys) and refreshes it when due
  return response;
}
