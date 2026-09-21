import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CenteredPage } from "@/components/page-shell";
import { getIdentity } from "@/features/open-play/server/auth";
import { safeNext } from "@/lib/redirects";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Officer sign-in" };

const ERRORS: Record<string, string> = {
  cancelled: "Google sign-in was cancelled.",
  failed: "Google sign-in didn't complete. Try again.",
};

export default async function AdminLogin({ searchParams }: PageProps<"/admin/login">) {
  const { next: rawNext, error } = await searchParams;
  const next = safeNext(rawNext) ?? "/admin";

  // Already signed in as an officer: nothing to do here. (Players hold anonymous sessions and don't count.)
  const me = await getIdentity();
  if (me?.role) redirect(next);

  return (
    <CenteredPage
      eyebrow="Officers"
      title="Sign in"
      description="Use the Google account an admin authorized, personal or through your school or work."
    >
      <LoginForm next={next} initialError={typeof error === "string" ? ERRORS[error] : undefined} />
    </CenteredPage>
  );
}
