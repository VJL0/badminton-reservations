import Link from "next/link";
import { redirect } from "next/navigation";
import { CenteredPage } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { sessionCodeSchema } from "@/features/open-play/schemas";
import { ctaClass } from "@/features/open-play/styles";
import { createClient } from "@/lib/supabase/server";

async function go(formData: FormData) {
  "use server";
  const code = sessionCodeSchema.safeParse(formData.get("code"));
  redirect(code.success ? `/play/${code.data}` : "/?invalid=1");
}

export default async function Home({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const invalid = params.invalid;
  const notFound = invalid === "notfound"; // a well-formed code that matches no session

  // The QR poster points here permanently: send players to whichever session is live.
  // A bad code entered by hand stays on this page so the error is visible.
  if (!invalid) {
    const { data, error } = await (await createClient()).rpc("get_active_session_code");
    if (error) throw new Error(`get_active_session_code failed: ${error.message}`);
    if (data) redirect(`/play/${data}`);
  }

  return (
    <CenteredPage
      title="Badminton Queue"
      description={
        notFound
          ? "We couldn't find that session, and none is running right now. Check the code on the poster."
          : invalid
            ? "Enter the session code from the poster."
            : "No open play is running right now. If you have a session code, enter it below."
      }
    >
      <form action={go}>
        <FieldGroup>
          <Field data-invalid={!!invalid}>
            <FieldLabel htmlFor="code">Session code</FieldLabel>
            <Input
              id="code"
              name="code"
              placeholder="E.g. K7M2QD"
              autoCapitalize="characters"
              autoComplete="off"
              aria-invalid={!!invalid}
              className="h-14 rounded-xl px-4 text-center text-xl font-bold tracking-widest uppercase md:text-xl"
            />
            {invalid && <FieldError>{notFound ? "No session with that code." : "Enter a valid session code."}</FieldError>}
          </Field>
          <Button type="submit" className={ctaClass}>
            Join open play
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Staff?{" "}
            <Link href="/admin/login" className="inline-flex min-h-11 items-center px-2 underline underline-offset-4 hover:text-foreground">
              Sign in
            </Link>
          </p>
        </FieldGroup>
      </form>
    </CenteredPage>
  );
}
