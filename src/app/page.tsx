import { redirect } from "next/navigation";
import { CenteredPage } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { sessionCodeSchema } from "@/features/open-play/schemas";
import { ctaClass } from "@/features/open-play/styles";

async function go(formData: FormData) {
  "use server";
  const code = sessionCodeSchema.safeParse(formData.get("code"));
  redirect(code.success ? `/play/${code.data}` : "/?invalid=1");
}

export default async function Home({ searchParams }: PageProps<"/">) {
  const invalid = (await searchParams).invalid;
  return (
    <CenteredPage
      title="Badminton Queue"
      description="Scan the QR code at the gym, or enter the session code."
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
              className="h-14 rounded-xl px-4 text-center text-xl font-bold uppercase tracking-widest md:text-xl"
            />
            {invalid && <FieldError>Enter a valid session code.</FieldError>}
          </Field>
          <Button type="submit" className={ctaClass}>Join open play</Button>
        </FieldGroup>
      </form>
    </CenteredPage>
  );
}
