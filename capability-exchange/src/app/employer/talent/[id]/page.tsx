import Link from "next/link";
import type { Metadata } from "next";
import { requireDiscoveryAccess } from "@/server/auth/current";
import { primaryMembership } from "@/server/policy/actor";
import { getTalentForEmployer, listShortlists } from "@/server/services/applications";
import { listOrganisationOpportunities, listRequirements } from "@/server/services/employer";
import { compareProfileToOpportunity } from "@/server/services/matching";
import { notFoundOnAppError } from "@/server/page-helpers";
import { ProfileDocument } from "@/components/profile-document";
import { ComparisonView } from "@/components/comparison-view";
import { ActionForm, SelectField, SubmitButton, TextAreaField } from "@/components/forms";
import { Card, PageHeader } from "@/components/ui";
import { ReportButton } from "@/components/report-button";
import { addToShortlistAction, requestIntroductionAction } from "../../actions";
import { AiComparePanel } from "@/components/ai-compare-panel";

export const metadata: Metadata = { title: "Profile" };

export default async function EmployerTalentPage({ params, searchParams }: PageProps<"/employer/talent/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const actor = await requireDiscoveryAccess();
  const { view } = await notFoundOnAppError(() => getTalentForEmployer(actor, id));
  const m = primaryMembership(actor)!;
  const [opps, lists] = await Promise.all([listOrganisationOpportunities(actor, m.organisationId), listShortlists(actor)]);
  const opp = opps.find((o) => o.id === sp.opportunity);
  const comparison = opp ? compareProfileToOpportunity(view, opp, await listRequirements(opp.id)) : null;
  return (
    <div>
      <PageHeader title={view.preferredName || view.fullName} description={view.headline} actions={<Link href="/employer/search">← Search</Link>} />
      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          {comparison && opp && (
            <Card>
              <h2 className="text-xl">Compared with “{opp.title}”</h2>
              <p className="mt-1 text-sm text-ink-muted">Rule-based and limited to what this person shares. Not a score; please read the profile.</p>
              <div className="mt-4"><ComparisonView comparison={comparison} /></div>
              <div className="mt-4"><AiComparePanel profileId={view.id} opportunityId={opp.id} /></div>
            </Card>
          )}
          <ProfileDocument view={view} ctx={{ kind: "live" }} />
        </div>
        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <Card>
            <h2 className="text-lg">Compare with an opportunity</h2>
            <form className="mt-3 space-y-3">
              <label htmlFor="opportunity" className="sr-only">Opportunity</label>
              <select id="opportunity" name="opportunity" defaultValue={opp?.id ?? ""} className="block w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5">
                <option value="">Choose…</option>
                {opps.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
              </select>
              <button className="rounded-lg border border-line-strong px-4 py-2 text-sm font-semibold">Compare</button>
            </form>
          </Card>
          {lists.length > 0 ? (
            <Card>
              <h2 className="text-lg">Shortlist</h2>
              <ActionForm action={addToShortlistAction} className="mt-3" aria-label="Add to shortlist">
                <input type="hidden" name="profileId" value={view.id} />
                <SelectField name="shortlistId" label="Shortlist" required options={lists.map((l) => ({ value: l.id, label: l.name }))} defaultValue={lists[0].id} />
                <TextAreaField name="note" label="Private note" rows={2} />
                <SubmitButton variant="secondary">Add to shortlist</SubmitButton>
              </ActionForm>
            </Card>
          ) : (
            <Card><p className="text-sm"><Link href="/employer/shortlists">Create a shortlist</Link> to save people.</p></Card>
          )}
          {!view.contact && (
            <Card>
              <h2 className="text-lg">Request an introduction</h2>
              <p className="mt-1 text-sm text-ink-muted">Contact details are shared only if they accept.</p>
              <ActionForm action={requestIntroductionAction} className="mt-3" resetOnSuccess aria-label="Request an introduction">
                <input type="hidden" name="profileId" value={view.id} />
                {opps.length > 0 && <SelectField name="opportunityId" label="About" options={opps.filter((o) => o.status === "published").map((o) => ({ value: o.id, label: o.title }))} />}
                <TextAreaField name="message" label="Message" required rows={4} />
                <SubmitButton variant="secondary">Send request</SubmitButton>
              </ActionForm>
            </Card>
          )}
          <ReportButton targetType="profile" targetId={view.id} />
        </aside>
      </div>
    </div>
  );
}
