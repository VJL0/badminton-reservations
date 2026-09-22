import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CenteredPage } from "@/components/page-shell";
import { safeNext } from "@/lib/redirects";
import { hasStaffSession } from "@/lib/staff-session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Staff sign-in" };

export default async function AdminLogin({ searchParams }: PageProps<"/admin/login">) {
  const next = safeNext((await searchParams).next) ?? "/admin";

  // Already signed in as staff: nothing to do here.
  if (await hasStaffSession()) redirect(next);

  return (
    <CenteredPage eyebrow="Staff" title="Sign in" description="Enter the staff code.">
      <LoginForm next={next} />
    </CenteredPage>
  );
}
