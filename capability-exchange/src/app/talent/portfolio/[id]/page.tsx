import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireTalent } from "@/server/auth/current";
import { getOwnProfile } from "@/server/services/profile";
import { buildProfileView, type ViewClaim, type ViewEvidence } from "@/server/services/profile-view";
import { profileChecks } from "@/server/services/profile-checks";
import { allowedUploadTypes } from "@/server/storage";
import { EngagementForm } from "@/components/engagement-form";
import { EvidenceUploader } from "@/components/evidence-uploader";
import { ActionForm, InlineAction, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/forms";
import { Alert, Badge, Card, EmptyState, PageHeader, VerificationBadge, VisibilityBadge, formatDate } from "@/components/ui";
import { claimTypes } from "@/config/taxonomy";
import {
  addEvidenceLinkAction,
  attachEvidenceAction,
  confirmClaimAction,
  deleteClaimAction,
  deleteEngagementAction,
  detachEvidenceAction,
  requestVerificationAction,
  saveClaimAction,
} from "../../actions";

export const metadata: Metadata = { title: "Project" };

function ClaimFields({ claim, engagementId }: { claim?: ViewClaim; engagementId: string }) {
  return (
    <>
      <input type="hidden" name="engagementId" value={engagementId} />
      {claim && <input type="hidden" name="claimId" value={claim.id} />}
      <TextAreaField name="text" label="Claim" required rows={2} maxLength={600} defaultValue={claim?.text} hint="One specific statement, e.g. “Reduced procurement cycle time from 90 to 60 days”." />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField name="claimType" label="Type" required options={claimTypes} defaultValue={claim?.claimType ?? "outcome"} />
        <TextField name="achievedOn" label="Date achieved" type="date" defaultValue={claim?.achievedOn} />
      </div>
      <SelectField name="visibility" label="Who can see it" required options={[{ value: "approved_employers", label: "Anyone I share my profile with" }, { value: "private", label: "Only me" }]} defaultValue={claim?.visibility ?? "approved_employers"} />
    </>
  );
}

function ClaimCard({ claim, engagementId, library }: { claim: ViewClaim; engagementId: string; library: ViewEvidence[] }) {
  const attached = library.filter((e) => claim.evidenceIds.includes(e.id));
  const attachable = library.filter((e) => !claim.evidenceIds.includes(e.id));
  return (
    <Card as="article" id={`claim-${claim.id}`}>
      <p className="text-lg">{claim.text}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <VerificationBadge status={claim.verificationStatus} />
        <VisibilityBadge visibility={claim.visibility} />
        {claim.verificationRequested && <Badge tone="info">Verification requested</Badge>}
        <span className="text-xs text-ink-soft">Last confirmed {formatDate(claim.lastConfirmedAt)}</span>
      </div>
      {claim.latestReview && (
        <Alert tone={claim.latestReview.decision === "independently_verified" ? "success" : "warning"} className="mt-3">
          <p>
            <strong>Latest review ({formatDate(claim.latestReview.reviewedAt)}):</strong> {claim.latestReview.scope}
          </p>
          {claim.latestReview.noteToCandidate && <p className="mt-1">Note: {claim.latestReview.noteToCandidate}</p>}
        </Alert>
      )}
      <h4 className="mt-4 text-sm font-semibold uppercase tracking-wide text-ink-muted">Evidence</h4>
      {attached.length === 0 ? (
        <p className="mt-1 text-sm text-ink-muted">None yet. Attach a file or link below. Attaching evidence does not verify a claim.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {attached.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span aria-hidden="true">{e.kind === "file" ? "📄" : "🔗"}</span>
              {e.kind === "file" ? <a href={`/api/evidence/${e.id}/download`}>{e.title}</a> : <a href={e.url!} target="_blank" rel="noopener noreferrer nofollow">{e.title}</a>}
              <VisibilityBadge visibility={e.visibility} />
              <InlineAction action={detachEvidenceAction} hidden={{ claimId: claim.id, evidenceId: e.id }} variant="ghost">
                Detach
              </InlineAction>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <details className="rounded-lg border border-line p-3">
          <summary className="cursor-pointer text-sm font-semibold">Upload a file for this claim</summary>
          <div className="mt-3">
            <EvidenceUploader claimId={claim.id} accept={allowedUploadTypes.join(",")} />
          </div>
        </details>
        <details className="rounded-lg border border-line p-3">
          <summary className="cursor-pointer text-sm font-semibold">Add a link or attach existing evidence</summary>
          <ActionForm action={addEvidenceLinkAction} className="mt-3" resetOnSuccess aria-label="Add evidence link">
            <input type="hidden" name="claimId" value={claim.id} />
            <TextField name="title" label="Title" required />
            <TextField name="url" label="Link" type="url" required placeholder="https://" />
            <SelectField name="visibility" label="Who can open it" required options={[{ value: "private", label: "Only me" }, { value: "approved_employers", label: "Shareable" }]} defaultValue="private" />
            <SubmitButton variant="secondary">Add link</SubmitButton>
          </ActionForm>
          {attachable.length > 0 && (
            <ActionForm action={attachEvidenceAction} className="mt-4 border-t border-line pt-4" aria-label="Attach existing evidence">
              <input type="hidden" name="claimId" value={claim.id} />
              <SelectField name="evidenceId" label="From your library" required placeholder="Choose evidence" options={attachable.map((e) => ({ value: e.id, label: e.title }))} />
              <SubmitButton variant="secondary">Attach</SubmitButton>
            </ActionForm>
          )}
        </details>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
        {claim.verificationStatus !== "independently_verified" && !claim.verificationRequested && attached.length > 0 && (
          <InlineAction action={requestVerificationAction} hidden={{ claimId: claim.id }}>
            Request verification
          </InlineAction>
        )}
        <InlineAction action={confirmClaimAction} hidden={{ claimId: claim.id }}>
          Still accurate
        </InlineAction>
        <InlineAction action={deleteClaimAction} hidden={{ claimId: claim.id }} variant="ghost" confirm="Delete this claim? Attached evidence stays in your library.">
          Delete claim
        </InlineAction>
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-semibold text-accent-strong">Edit wording</summary>
        {claim.verificationStatus === "independently_verified" && <Alert tone="warning" className="mt-2">Changing the wording removes the independent verification, because the reviewer checked the current wording.</Alert>}
        <ActionForm action={saveClaimAction} className="mt-3" aria-label="Edit claim">
          <ClaimFields claim={claim} engagementId={engagementId} />
          <SubmitButton>Save claim</SubmitButton>
        </ActionForm>
      </details>
    </Card>
  );
}

export default async function EngagementPage({ params, searchParams }: PageProps<"/talent/portfolio/[id]">) {
  const { id } = await params;
  const { saved } = await searchParams;
  const actor = await requireTalent();
  const view = await buildProfileView(await getOwnProfile(actor), { kind: "owner" });
  const engagement = view.engagements.find((e) => e.id === id);
  if (!engagement) notFound();
  const checks = profileChecks(view).filter((c) => c.target.id === id || engagement.claims.some((cl) => cl.id === c.target.id));

  return (
    <div>
      <PageHeader
        eyebrow="Evidence Portfolio"
        title={engagement.title}
        description={[engagement.roleTitle, engagement.organisationLabel].filter(Boolean).join(" · ")}
        actions={<Link href="/talent/portfolio">← All projects</Link>}
      />
      {saved && <Alert tone="success" className="mb-6">Saved.</Alert>}
      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <section aria-labelledby="claims-h" className="space-y-4">
            <h2 id="claims-h" className="text-2xl">
              Claims
            </h2>
            <p className="text-sm text-ink-muted">Significant statements about this work. Each carries a label showing what supports it.</p>
            {engagement.claims.length === 0 && <EmptyState title="No claims yet">Add the outcomes or responsibilities you would want an employer to check.</EmptyState>}
            {engagement.claims.map((c) => (
              <ClaimCard key={c.id} claim={c} engagementId={engagement.id} library={view.evidence} />
            ))}
            <Card>
              <h3 className="text-lg">Add a claim</h3>
              <ActionForm action={saveClaimAction} className="mt-3" resetOnSuccess aria-label="Add a claim">
                <ClaimFields engagementId={engagement.id} />
                <SubmitButton>Add claim</SubmitButton>
              </ActionForm>
            </Card>
          </section>
          <section aria-labelledby="details-h">
            <h2 id="details-h" className="mb-4 text-2xl">
              Details
            </h2>
            <Card>
              <EngagementForm engagement={engagement} capabilities={view.capabilities} />
            </Card>
            <div className="mt-4">
              <InlineAction action={deleteEngagementAction} hidden={{ engagementId: engagement.id }} variant="danger" confirm="Delete this project and its claims? Evidence files stay in your library.">
                Delete project
              </InlineAction>
            </div>
          </section>
        </div>
        <aside aria-label="Questions about this project" className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <Card>
            <h2 className="text-lg">Questions to consider</h2>
            {checks.length === 0 ? (
              <p className="mt-2 text-sm text-ink-muted">No open questions for this project.</p>
            ) : (
              <ul className="mt-3 space-y-3 text-sm">
                {checks.map((c) => (
                  <li key={c.id}>
                    <p>{c.question}</p>
                    <p className="text-ink-soft">{c.why}</p>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/talent/assistant" className="mt-3 inline-block text-sm font-semibold">
              Ask the assistant for wording suggestions
            </Link>
          </Card>
        </aside>
      </div>
    </div>
  );
}
