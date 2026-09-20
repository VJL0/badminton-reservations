import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { CenteredPage } from "@/components/page-shell";
import { getIdentity } from "@/features/open-play/server/auth";
import { appUrlFor } from "@/lib/env.server";
import { safeNext } from "@/lib/redirects";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Officer sign-in" };

export default async function AdminLogin({ searchParams }: PageProps<"/admin/login">) {
  const next = safeNext((await searchParams).next) ?? "/admin";

  // Already signed in as an officer: nothing to do here. (Players hold anonymous sessions and don't count.)
  const me = await getIdentity();
  if (me?.role) redirect(next);

  // Reading request headers also makes this page dynamic, which the per-request CSP nonce requires.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <CenteredPage eyebrow="Officers" title="Sign in" description="Use your officer email and password.">
      <LoginForm nonce={nonce} next={next} resetRedirect={appUrlFor("/admin/onboarding")} />
    </CenteredPage>
  );
}
