import type { Metadata } from "next";
import { requireAdmin } from "@/server/auth/current";
import { listOrganisationsForReview } from "@/server/services/admin";
import { ActionForm, SelectField, SubmitButton, TextAreaField } from "@/components/forms";
import { Badge, Card, DemoTag, PageHeader, formatDate } from "@/components/ui";
import { reviewOrganisationAction } from "../actions";

export const metadata: Metadata = { title: "Employer registrations" };

export default async function OrganisationsReviewPage() {
  const actor = await requireAdmin();
  const orgs = await listOrganisationsForReview(actor);
  return (
    <div>
      <PageHeader title="Employer registrations" description="Approval opens talent search and publishing for that organisation." />
      <ul className="space-y-4">
        {orgs.map(({ org, creatorName, creatorEmail }) => (
          <Card as="li" key={org.id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-xl">{org.name}</h2>
                <p className="text-sm text-ink-muted">{[org.country, org.sector, org.sizeBand && `${org.sizeBand} people`].filter(Boolean).join(" · ")} · registered {formatDate(org.createdAt)} by {creatorName ?? "a deleted account"} ({creatorEmail})</p>
                {org.website && <a href={org.website} target="_blank" rel="noopener noreferrer nofollow" className="text-sm">{org.website}</a>}
              </div>
              <div className="flex gap-2">
                {org.isDemo && <DemoTag />}
                <Badge tone={org.status === "approved" ? "success" : org.status === "pending" ? "warning" : "danger"}>{org.status}</Badge>
              </div>
            </div>
            {org.description && <p className="mt-2 text-sm">{org.description}</p>}
            {org.registrationNote && <p className="mt-2 text-sm"><strong>Note for reviewer:</strong> {org.registrationNote}</p>}
            {org.reviewReason && <p className="mt-2 text-sm text-ink-muted">Last decision {formatDate(org.reviewedAt)}: {org.reviewReason}</p>}
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-semibold text-accent-strong">Record a decision</summary>
              <ActionForm action={reviewOrganisationAction} className="mt-3 max-w-lg" aria-label={`Decision for ${org.name}`}>
                <input type="hidden" name="organisationId" value={org.id} />
                <SelectField name="decision" label="Decision" required options={[{ value: "approved", label: "Approve" }, { value: "rejected", label: "Reject" }, { value: "suspended", label: "Suspend" }]} defaultValue={org.status === "pending" ? "approved" : org.status} />
                <TextAreaField name="reason" label="Reason (kept in the audit record)" required rows={2} />
                <SubmitButton>Record decision</SubmitButton>
              </ActionForm>
            </details>
          </Card>
        ))}
      </ul>
    </div>
  );
}
