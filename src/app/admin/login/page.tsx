import type { Metadata } from "next";
import { headers } from "next/headers";
import { CenteredPage } from "@/components/page-shell";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Officer sign-in" };

export default async function AdminLogin() {
  // Reading request headers also makes this page dynamic, which the per-request CSP nonce requires.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <CenteredPage eyebrow="Officers" title="Sign in" description="Use your officer email and password.">
      <LoginForm nonce={nonce} />
    </CenteredPage>
  );
}
