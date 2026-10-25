import type { Metadata } from "next";
import { requireAdmin } from "@/server/auth/current";
import { getClaimForReview } from "@/server/services/admin";
import { notFoundOnAppError } from "@/server/page-helpers";
import { ActionForm, CheckboxGroup, RadioGroup, SelectField, SubmitButton, TextAreaField } from "@/components/forms";
import { Alert, Card, DefinitionRow, PageHeader, VerificationBadge, formatDate } from "@/components/ui";
import { engagementStages, labelOf, verificationMethods } from "@/config/taxonomy";
import { verificationReviewAction } from "../../actions";

export const metadata: Metadata = { title: "Review a claim" };

export default async function ReviewClaimPage({ params }: PageProps<"/admin/verification/[claimId]">) {
  const { claimId } = await params;
  const actor = await requireAdmin();
  const r = await notFoundOnAppError(() => getClaimForReview(actor, claimId));
  const e = r.engagement;
  return (
    <div>
      <PageHeader eyebrow={`Claim by ${r.candidateName}`} title="Review a claim" />
      <div className="grid gap-8 lg:grid-cols-[1fr_24rem]">
        <div className="space-y-6">
          <Card>
            <p className="text-lg">“{r.claim.text}”</p>
            <div className="mt-2"><VerificationBadge status={r.claim.verificationStatus} /></div>
            {e && (
              <dl className="mt-4">
                <DefinitionRow term="Project">{e.title}</DefinitionRow>
                <DefinitionRow term="Organisation">{e.confidentiality === "anonymised" ? `${e.anonymisedDescription} (anonymised; real name: ${e.organisationName ?? "not given"})` : e.organisationName}</DefinitionRow>
                <DefinitionRow term="Dates">{[e.startDate, e.isCurrent ? "present" : e.endDate].filter(Boolean).join(" to ") || "Not provided"}</DefinitionRow>
                <DefinitionRow term="Stage reached">{labelOf(engagementStages, e.stageReached)}</DefinitionRow>
                <DefinitionRow term="What they did">{e.individualActions ?? "Not provided"}</DefinitionRow>
              </dl>
            )}
          </Card>
          <Card>
            <h2 className="text-xl">Evidence attached</h2>
            <p className="mt-1 text-sm text-ink-muted">Opening files is recorded in the audit log.</p>
            <ul className="mt-3 space-y-2">
              {r.evidence.map((ev) => (
                <li key={ev.id} className="text-sm">
                  {ev.kind === "file" ? <a href={`/api/evidence/${ev.id}/download`}>📄 {ev.title}</a> : <a href={ev.url!} target="_blank" rel="noopener noreferrer nofollow">🔗 {ev.title}</a>}
                  {ev.isRedacted && <span className="text-ink-muted"> · redacted{ev.redactionNote ? `: ${ev.redactionNote}` : ""}</span>}
                  {ev.description && <span className="block text-ink-muted">{ev.description}</span>}
                </li>
              ))}
            </ul>
          </Card>
          {r.reviews.length > 0 && (
            <Card>
              <h2 className="text-xl">Previous reviews</h2>
              <ul className="mt-3 space-y-3 text-sm">
                {r.reviews.map(({ review, reviewerName }) => (
                  <li key={review.id}>
                    <strong>{review.decision.replaceAll("_", " ")}</strong> · {labelOf(verificationMethods, review.method)} · {formatDate(review.reviewedAt)} by {reviewerName ?? "former reviewer"}
                    <span className="block">Scope: {review.scope}</span>
                    <span className="block text-ink-muted">Reason: {review.reason}</span>
                    {review.claimTextAtReview !== r.claim.text && <span className="block text-warning">The claim wording has changed since this review.</span>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <Card className="lg:self-start">
          <h2 className="text-xl">Record your decision</h2>
          <Alert tone="info" className="mt-3">You cannot edit the claim. If it needs changing, request clarification and explain why.</Alert>
          <ActionForm action={verificationReviewAction} className="mt-4" aria-label="Record verification decision">
            <input type="hidden" name="claimId" value={r.claim.id} />
            <RadioGroup
              name="decision"
              label="Decision"
              required
              options={[
                { value: "independently_verified", label: "Independently verified", help: "The evidence supports the claim as worded." },
                { value: "clarification_requested", label: "Clarification requested", help: "More detail or different evidence is needed." },
                { value: "not_verified", label: "Not verified", help: "Returns to its evidence-based label." },
              ]}
            />
            <SelectField name="method" label="How you checked" required options={verificationMethods} placeholder="Choose a method" />
            {r.evidence.length > 0 && <CheckboxGroup name="evidenceIdsReviewed" label="Evidence you reviewed" options={r.evidence.map((ev) => ({ value: ev.id, label: ev.title }))} />}
            <TextAreaField name="scope" label="What exactly was checked (shown to employers)" required rows={3} hint="e.g. “Checked the redacted close notice: project, date and adviser role. Did not check amounts.”" />
            <TextAreaField name="noteToCandidate" label="Note to the candidate" rows={2} />
            <TextAreaField name="reason" label="Reason for the decision (audit record)" required rows={2} />
            <SubmitButton>Record review</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </div>
  );
}
