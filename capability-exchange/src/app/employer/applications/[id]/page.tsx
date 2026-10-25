import Link from "next/link";
import type { Metadata } from "next";
import { requireEmployer } from "@/server/auth/current";
import { getApplicationForEmployer } from "@/server/services/applications";
import { notFoundOnAppError } from "@/server/page-helpers";
import { ProfileDocument } from "@/components/profile-document";
import { ComparisonView } from "@/components/comparison-view";
import { ActionForm, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/forms";
import { Alert, Badge, Card, PageHeader, formatDate } from "@/components/ui";
import { applicationStatuses, labelOf } from "@/config/taxonomy";
import { addNoteAction, applicationStatusAction, requestIntroductionAction } from "../../actions";

export const metadata: Metadata = { title: "Application" };

const settable = applicationStatuses.filter((s) => ["in_review", "shortlisted", "interviewing", "offer", "not_progressing"].includes(s.value));

export default async function EmployerApplicationPage({ params }: PageProps<"/employer/applications/[id]">) {
  const { id } = await params;
  const actor = await requireEmployer();
  const v = await notFoundOnAppError(() => getApplicationForEmployer(actor, id));
  const a = v.application;
  return (
    <div>
      <PageHeader
        eyebrow={v.opportunity.title}
        title={a.candidateDisplayName}
        description={<span className="flex flex-wrap items-center gap-2"><Badge tone="accent">{labelOf(applicationStatuses, a.status)}</Badge> Applied {formatDate(a.createdAt)}</span>}
        actions={<Link href={`/employer/opportunities/${v.opportunity.id}`}>← Opportunity</Link>}
      />
      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          {a.status === "withdrawn" ? (
            <Alert tone="info" title="Withdrawn by the candidate">The profile they shared is no longer available. Your notes and the status history remain.</Alert>
          ) : (
            <>
              <Card>
                <h2 className="text-xl">Expression of interest</h2>
                <p className="mt-2 whitespace-pre-line">{a.expressionOfInterest}</p>
              </Card>
              {v.comparison && (
                <Card>
                  <h2 className="text-xl">Requirements compared with the shared profile</h2>
                  <p className="mt-1 text-sm text-ink-muted">A rule-based reading of what the candidate shared. It is not a score and it does not decide anything: please read the profile.</p>
                  <div className="mt-4"><ComparisonView comparison={v.comparison} /></div>
                </Card>
              )}
              {v.snapshot && (
                <section aria-labelledby="snap-h">
                  <h2 id="snap-h" className="text-2xl">Profile shared with you</h2>
                  <p className="mb-4 mt-1 text-sm text-ink-muted">A fixed copy taken on {formatDate(v.snapshotTakenAt)}. Later changes by the candidate do not alter it.</p>
                  <ProfileDocument view={v.snapshot} ctx={v.snapshotIncludesEvidence ? { kind: "application", applicationId: a.id } : { kind: "none" }} />
                </section>
              )}
            </>
          )}
        </div>
        <aside className="space-y-4">
          {a.status !== "withdrawn" && (
            <Card>
              <h2 className="text-lg">Decision</h2>
              <p className="mt-1 text-xs text-ink-muted">Every change is recorded with your name.</p>
              <ActionForm action={applicationStatusAction} className="mt-3" aria-label="Update status">
                <input type="hidden" name="applicationId" value={a.id} />
                <SelectField name="status" label="Status" required options={settable} defaultValue={settable.some((s) => s.value === a.status) ? a.status : "in_review"} />
                <TextField name="note" label="Reason or note for the history" />
                <SubmitButton variant="secondary">Update status</SubmitButton>
              </ActionForm>
            </Card>
          )}
          {a.status !== "withdrawn" && a.profileId && (
            <Card>
              <h2 className="text-lg">Introduction</h2>
              {v.introduction ? (
                <p className="mt-2 text-sm">Requested {formatDate(v.introduction.createdAt)} · <Badge tone={v.introduction.status === "accepted" ? "success" : "info"}>{v.introduction.status}</Badge></p>
              ) : v.snapshot?.contact ? (
                <p className="mt-2 text-sm text-ink-muted">The candidate shared contact details with this application.</p>
              ) : (
                <ActionForm action={requestIntroductionAction} className="mt-3" aria-label="Request an introduction">
                  <input type="hidden" name="profileId" value={a.profileId} />
                  <input type="hidden" name="applicationId" value={a.id} />
                  <input type="hidden" name="opportunityId" value={v.opportunity.id} />
                  <TextAreaField name="message" label="Message to the candidate" required rows={4} />
                  <SubmitButton variant="secondary">Request introduction</SubmitButton>
                </ActionForm>
              )}
            </Card>
          )}
          <Card>
            <h2 className="text-lg">Private notes</h2>
            <p className="mt-1 text-xs text-ink-muted">Visible to your organisation only. Candidates never see them.</p>
            <ul className="mt-3 space-y-3 text-sm">
              {v.notes.map((n) => (
                <li key={n.id} className="rounded-lg bg-surface-muted p-3">
                  <p className="whitespace-pre-line">{n.body}</p>
                  <p className="mt-1 text-xs text-ink-soft">{formatDate(n.createdAt)}</p>
                </li>
              ))}
            </ul>
            <ActionForm action={addNoteAction} className="mt-3" resetOnSuccess aria-label="Add a note">
              <input type="hidden" name="applicationId" value={a.id} />
              <TextAreaField name="body" label="Add a note" required rows={3} />
              <SubmitButton variant="secondary">Save note</SubmitButton>
            </ActionForm>
          </Card>
          <Card>
            <h2 className="text-lg">History</h2>
            <ol className="mt-3 space-y-2 text-sm">
              {v.events.map((e, i) => (
                <li key={i}>
                  <strong>{labelOf(applicationStatuses, e.toStatus)}</strong> · {formatDate(e.createdAt)}
                  {e.actorName && <span className="text-ink-muted"> · {e.actorName}</span>}
                  {e.note && <span className="block text-ink-muted">{e.note}</span>}
                </li>
              ))}
            </ol>
          </Card>
        </aside>
      </div>
    </div>
  );
}
