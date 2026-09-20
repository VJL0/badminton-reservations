import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { CenteredPage } from "@/components/page-shell";
import { safeNext } from "@/lib/redirects";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Officer sign-in" };

export default async function AdminLogin({ searchParams }: PageProps<"/admin/login">) {
  const next = safeNext((await searchParams).next) ?? "/admin";

  // Already signed in as an officer: nothing to do here. (Players hold anonymous sessions and don't count.)
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (claims?.claims && !claims.claims.is_anonymous) {
    const { error } = await supabase.rpc("list_sessions"); // any officer may call it
    if (!error) redirect(next);
  }

  // Reading request headers also makes this page dynamic, which the per-request CSP nonce requires.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <CenteredPage eyebrow="Officers" title="Sign in" description="Use your officer email and password.">
      <LoginForm nonce={nonce} next={next} />
    </CenteredPage>
  );
}
