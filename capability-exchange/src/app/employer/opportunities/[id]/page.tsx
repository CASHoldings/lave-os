import Link from "next/link";
import type { Metadata } from "next";
import { requireEmployer } from "@/server/auth/current";
import { getOwnOpportunity, listRequirements } from "@/server/services/employer";
import { listApplicationsForOpportunity } from "@/server/services/applications";
import { notFoundOnAppError } from "@/server/page-helpers";
import { OpportunityBody, OpportunityFacts } from "@/components/opportunity-summary";
import { ActionForm, InlineAction, SelectField, SubmitButton, TextField } from "@/components/forms";
import { Alert, Badge, ButtonLink, Card, EmptyState, PageHeader, formatDate } from "@/components/ui";
import { applicationStatuses, labelOf, proficiencyLevels } from "@/config/taxonomy";
import { canDiscoverTalent } from "@/server/policy/actor";
import { addRequirementAction, opportunityStatusAction, removeRequirementAction } from "../../actions";
import { OpportunityClarityPanel } from "@/components/opportunity-clarity-panel";

export const metadata: Metadata = { title: "Opportunity" };

export default async function EmployerOpportunityPage({ params, searchParams }: PageProps<"/employer/opportunities/[id]">) {
  const { id } = await params;
  const { saved } = await searchParams;
  const actor = await requireEmployer();
  const o = await notFoundOnAppError(() => getOwnOpportunity(actor, id));
  const [requirements, apps] = await Promise.all([listRequirements(o.id), listApplicationsForOpportunity(actor, o.id)]);
  const approved = canDiscoverTalent(actor);
  return (
    <div>
      <PageHeader
        eyebrow={`Opportunity · ${o.status}`}
        title={o.title}
        actions={
          <>
            <ButtonLink href={`/employer/opportunities/${o.id}/edit`} variant="secondary">Edit details</ButtonLink>
            {approved && <ButtonLink href={`/employer/search?opportunity=${o.id}`} variant="secondary">Find matching talent</ButtonLink>}
          </>
        }
      />
      {saved && <Alert tone="success" className="mb-6">Saved.</Alert>}
      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Card>
            <h2 className="text-xl">Applications ({apps.length})</h2>
            {apps.length === 0 ? (
              <div className="mt-3"><EmptyState title="No applications yet" /></div>
            ) : (
              <ul className="mt-3 divide-y divide-line">
                {apps.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <span>
                      <Link href={`/employer/applications/${a.id}`} className="font-semibold">{a.candidateDisplayName}</Link>
                      <span className="text-sm text-ink-muted"> · {formatDate(a.createdAt)}</span>
                    </span>
                    <Badge tone={a.status === "withdrawn" ? "neutral" : "accent"}>{labelOf(applicationStatuses, a.status)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <h2 className="text-xl">Requirements</h2>
            <p className="mt-1 text-sm text-ink-muted">Each requirement is assessed separately against what candidates share. Keep them about the work.</p>
            <ul className="mt-3 divide-y divide-line">
              {requirements.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <span>
                    {r.label} <Badge tone={r.importance === "essential" ? "accent" : "neutral"}>{r.importance}</Badge>
                    {r.minProficiency && <span className="text-sm text-ink-muted"> · {labelOf(proficiencyLevels, r.minProficiency)} or above</span>}
                  </span>
                  <InlineAction action={removeRequirementAction} hidden={{ opportunityId: o.id, requirementId: r.id }} variant="ghost">Remove</InlineAction>
                </li>
              ))}
            </ul>
            <ActionForm action={addRequirementAction} className="mt-4 border-t border-line pt-4" resetOnSuccess aria-label="Add a requirement">
              <input type="hidden" name="opportunityId" value={o.id} />
              <TextField name="label" label="Requirement" required hint="For capabilities, use a common name such as “Project finance”." />
              <div className="grid gap-4 sm:grid-cols-3">
                <SelectField name="kind" label="Kind" required options={[{ value: "capability", label: "Capability" }, { value: "experience", label: "Experience" }, { value: "evidence", label: "Evidence" }, { value: "language", label: "Language" }, { value: "other", label: "Other" }]} defaultValue="capability" />
                <SelectField name="importance" label="Importance" required options={[{ value: "essential", label: "Essential" }, { value: "desirable", label: "Desirable" }]} defaultValue="essential" />
                <SelectField name="minProficiency" label="Minimum level" options={proficiencyLevels} />
              </div>
              <SubmitButton variant="secondary">Add requirement</SubmitButton>
            </ActionForm>
          </Card>
          <OpportunityBody o={o} requirements={requirements} />
        </div>
        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <Card>
            <h2 className="text-lg">Status</h2>
            <p className="mt-1 text-sm text-ink-muted">
              {o.status === "draft" && "Only your organisation can see drafts."}
              {o.status === "published" && `Published ${formatDate(o.publishedAt)}. Visible to signed-in professionals.`}
              {o.status === "closed" && `Closed ${formatDate(o.closedAt)}. No new applications.`}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {o.status !== "published" && (
                <InlineAction action={opportunityStatusAction} hidden={{ opportunityId: o.id, status: "published" }} variant="primary">Publish</InlineAction>
              )}
              {o.status === "published" && <InlineAction action={opportunityStatusAction} hidden={{ opportunityId: o.id, status: "closed" }} confirm="Close this opportunity to new applications?">Close</InlineAction>}
              {o.status !== "draft" && <InlineAction action={opportunityStatusAction} hidden={{ opportunityId: o.id, status: "draft" }} variant="ghost">Back to draft</InlineAction>}
            </div>
            {!approved && <p className="mt-2 text-xs text-warning">Publishing opens after your organisation is approved.</p>}
          </Card>
          <OpportunityClarityPanel opportunityId={o.id} />
          <Card><OpportunityFacts o={o} /></Card>
        </aside>
      </div>
    </div>
  );
}
