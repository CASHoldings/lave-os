import Link from "next/link";
import type { Metadata } from "next";
import { and, eq } from "drizzle-orm";
import { requireActor } from "@/server/auth/current";
import { getPublishedOpportunity } from "@/server/services/employer";
import { buildProfileView } from "@/server/services/profile-view";
import { compareProfileToOpportunity } from "@/server/services/matching";
import { getOwnProfile } from "@/server/services/profile";
import { getDb } from "@/server/db/client";
import { applications } from "@/server/db/schema";
import { OpportunityBody, OpportunityFacts } from "@/components/opportunity-summary";
import { ComparisonView } from "@/components/comparison-view";
import { ActionForm, Checkbox, SubmitButton, TextAreaField } from "@/components/forms";
import { Alert, ButtonLink, Card, PageHeader } from "@/components/ui";
import { ReportButton } from "@/components/report-button";
import { applyAction } from "@/app/talent/actions";

export const metadata: Metadata = { title: "Opportunity" };

export default async function OpportunityPage({ params }: PageProps<"/opportunities/[id]">) {
  const { id } = await params;
  const actor = await requireActor(`/opportunities/${id}`);
  const { opportunity: o, organisation, requirements } = await getPublishedOpportunity(id);
  let ownSection: React.ReactNode = null;

  if (actor.profileId) {
    const profile = await getOwnProfile(actor);
    const [existing] = await getDb().select({ id: applications.id }).from(applications).where(and(eq(applications.opportunityId, o.id), eq(applications.profileId, profile.id))).limit(1);
    const employerView = await buildProfileView(profile, { kind: "snapshot", includeContact: false, includeEvidence: true });
    const comparison = compareProfileToOpportunity(employerView, o, requirements);
    ownSection = (
      <div className="space-y-6">
        <Card>
          <h2 className="text-xl">How your profile compares</h2>
          <p className="mt-1 text-sm text-ink-muted">Based on what you share with employers. A rule-based comparison for your information, not a score. The employer makes their own judgement.</p>
          <div className="mt-4">
            <ComparisonView comparison={comparison} compact />
          </div>
        </Card>
        <Card id="apply">
          <h2 className="text-xl">Apply</h2>
          {existing ? (
            <Alert tone="info" className="mt-3">
              You have applied. <Link href={`/talent/applications/${existing.id}`}>View your application</Link>.
            </Alert>
          ) : !profile.coreCompletedAt ? (
            <Alert tone="warning" className="mt-3" title="Complete your core profile first">
              Employers receive a copy of your profile, so it needs the essentials. <Link href="/talent/profile">Finish your core profile</Link>.
            </Alert>
          ) : (
            <ActionForm action={applyAction} className="mt-3" aria-label="Apply for this opportunity">
              <input type="hidden" name="opportunityId" value={o.id} />
              <TextAreaField name="expressionOfInterest" label="Expression of interest" required rows={6} maxLength={2000} hint="A few sentences on why this opportunity and what you would bring. Refer to specific projects." />
              <Checkbox name="includeContact" label="Share my email and phone with this organisation" />
              <Checkbox name="includeEvidence" label="Let them open the evidence I have marked shareable" defaultChecked />
              <p className="text-sm text-ink-muted">
                The organisation receives a fixed copy of your profile as approved employers see it (<Link href="/talent/profile/preview?as=employer">preview it</Link>). Later edits will not change it. If you withdraw, they lose access to it.
              </p>
              <Checkbox name="confirm" label="I have reviewed what will be shared" />
              <SubmitButton pendingLabel="Submitting…">Submit application</SubmitButton>
            </ActionForm>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader eyebrow={organisation.name} title={o.title} actions={actor.profileId ? <ButtonLink href="#apply">Apply</ButtonLink> : undefined} />
      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <OpportunityBody o={o} requirements={requirements} />
          {ownSection}
        </div>
        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <Card>
            <OpportunityFacts o={o} />
          </Card>
          {organisation.description && (
            <Card>
              <h2 className="text-lg">About {organisation.name}</h2>
              <p className="mt-2 text-sm">{organisation.description}</p>
            </Card>
          )}
          <ReportButton targetType="opportunity" targetId={o.id} />
        </aside>
      </div>
    </div>
  );
}
