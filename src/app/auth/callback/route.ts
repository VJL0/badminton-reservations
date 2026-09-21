import { type NextRequest, NextResponse } from "next/server";
import { safeNext } from "@/lib/redirects";
import { createClient } from "@/lib/supabase/server";

/**
 * Where Google sends staff back to, through Supabase. The browser started the PKCE flow and holds its code verifier
 * in a cookie; here the one-time `code` is exchanged for a session (set as cookies by the server client). That only
 * proves who they are. Whether they are staff is decided afterwards, by the database, on the page they land on.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNext(searchParams.get("next")) ?? "/admin";
  const failed = (reason: "cancelled" | "failed") => NextResponse.redirect(new URL(`/admin/login?error=${reason}`, origin));

  // Google (or Supabase) turned the sign-in down, e.g. the person pressed Cancel.
  if (searchParams.has("error")) return failed("cancelled");
  const code = searchParams.get("code");
  if (!code) return failed("failed");

  const { error } = await (await createClient()).auth.exchangeCodeForSession(code);
  if (error) {
    console.warn(JSON.stringify({ level: "warn", event: "oauth_exchange_failed", code: error.code, status: error.status }));
    return failed("failed");
  }
  return NextResponse.redirect(new URL(next, origin));
}
