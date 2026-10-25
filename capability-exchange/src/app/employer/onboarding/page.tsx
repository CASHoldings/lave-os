import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireActor } from "@/server/auth/current";
import { ActionForm, SubmitButton, TextAreaField } from "@/components/forms";
import { Alert, Card, PageHeader } from "@/components/ui";
import { OrganisationFields } from "@/components/organisation-fields";
import { registerOrganisationAction } from "../actions";

export const metadata: Metadata = { title: "Set up your organisation" };

export default async function OnboardingPage() {
  const actor = await requireActor("/employer/onboarding");
  if (actor.memberships.length) redirect("/employer");
  if (actor.profileId) redirect("/talent");
  return (
    <div className="max-w-2xl">
      <PageHeader eyebrow="Employer onboarding" title="Set up your organisation" description="Tell us who you are. A platform administrator reviews each organisation before talent search opens." />
      <Alert tone="info" className="mb-6" title="What happens next">
        While your organisation is under review you can draft opportunities and invite colleagues. Publishing and talent search open after approval.
      </Alert>
      <Card>
        <ActionForm action={registerOrganisationAction} aria-label="Register your organisation">
          <OrganisationFields />
          <TextAreaField name="registrationNote" label="Note for the reviewer" rows={3} hint="What kinds of roles or projects you expect to hire for." />
          <SubmitButton>Submit for review</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
