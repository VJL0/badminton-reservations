import type { Metadata } from "next";
import { connection } from "next/server";
import { CenteredPage } from "@/components/page-shell";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Choose a password" };

// Where the link in an invitation or a password-reset email lands. Supabase has already signed the person in
// with the link; this only asks them to choose the password they will use from now on.
export default async function Onboarding() {
  await connection(); // the per-request CSP nonce needs every page rendered per request
  return (
    <CenteredPage eyebrow="Officers" title="Choose a password" description="This is the password you'll use to sign in from now on.">
      <OnboardingForm />
    </CenteredPage>
  );
}
