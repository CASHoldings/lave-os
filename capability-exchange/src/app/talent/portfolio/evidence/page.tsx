import type { Metadata } from "next";
import { requireTalent } from "@/server/auth/current";
import { getOwnProfile } from "@/server/services/profile";
import { buildProfileView } from "@/server/services/profile-view";
import { allowedUploadTypes } from "@/server/storage";
import { EvidenceUploader } from "@/components/evidence-uploader";
import { ActionForm, InlineAction, SelectField, SubmitButton, TextField } from "@/components/forms";
import { Alert, Badge, Card, EmptyState, PageHeader, VisibilityBadge, formatDate } from "@/components/ui";
import { addEvidenceLinkAction, deleteEvidenceAction, evidenceVisibilityAction } from "../../actions";

export const metadata: Metadata = { title: "Evidence library" };

export default async function EvidenceLibraryPage() {
  const actor = await requireTalent();
  const profile = await getOwnProfile(actor);
  const view = await buildProfileView(profile, { kind: "owner" });
  const allClaims = [...view.engagements.flatMap((e) => e.claims), ...view.standaloneClaims];
  return (
    <div>
      <PageHeader eyebrow="Evidence Portfolio" title="Evidence library" description="Files and links that support your claims. Files are kept in private storage and downloads use short-lived links." />
      {profile.evidenceVisibility === "private" && (
        <Alert tone="info" className="mb-6">
          Your evidence setting is private: employers see that evidence exists, but cannot open it, even for items marked shareable. Change this in your profile&apos;s sharing settings.
        </Alert>
      )}
      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-3">
          {view.evidence.length === 0 && <EmptyState title="No evidence yet">Upload a document (redacted is fine) or add a link to public work.</EmptyState>}
          {view.evidence.map((e) => {
            const used = allClaims.filter((c) => c.evidenceIds.includes(e.id));
            return (
              <Card key={e.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">
                      <span aria-hidden="true">{e.kind === "file" ? "📄 " : "🔗 "}</span>
                      {e.kind === "file" ? <a href={`/api/evidence/${e.id}/download`}>{e.title}</a> : <a href={e.url!} target="_blank" rel="noopener noreferrer nofollow">{e.title}</a>}
                    </p>
                    <p className="text-sm text-ink-muted">
                      {e.kind === "file" ? `${e.fileName} · ${Math.max(1, Math.round((e.sizeBytes ?? 0) / 1024))} KB` : e.url} · added {formatDate(e.createdAt)}
                    </p>
                    {e.description && <p className="mt-1 text-sm">{e.description}</p>}
                    <p className="mt-1 text-sm text-ink-muted">{used.length ? `Supports: ${used.map((c) => `“${c.text.slice(0, 50)}”`).join(", ")}` : "Not attached to a claim yet."}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {e.isRedacted && <Badge>Redacted</Badge>}
                    <VisibilityBadge visibility={e.visibility} />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <InlineAction action={evidenceVisibilityAction} hidden={{ evidenceId: e.id, visibility: e.visibility === "private" ? "approved_employers" : "private" }}>
                    {e.visibility === "private" ? "Make shareable" : "Make private"}
                  </InlineAction>
                  <InlineAction action={deleteEvidenceAction} hidden={{ evidenceId: e.id }} variant="ghost" confirm="Delete this evidence permanently? The stored file is removed too.">
                    Delete
                  </InlineAction>
                </div>
              </Card>
            );
          })}
        </div>
        <div className="space-y-6">
          <Card>
            <h2 className="text-lg">Upload a file</h2>
            <div className="mt-3">
              <EvidenceUploader accept={allowedUploadTypes.join(",")} />
            </div>
            <p className="mt-3 text-xs text-ink-soft">Automatic reading of document text is not available in this version. Files are stored as uploaded.</p>
          </Card>
          <Card>
            <h2 className="text-lg">Add a link</h2>
            <ActionForm action={addEvidenceLinkAction} className="mt-3" resetOnSuccess aria-label="Add a link">
              <TextField name="title" label="Title" required />
              <TextField name="url" label="Link" type="url" required placeholder="https://" />
              <SelectField name="visibility" label="Who can open it" required options={[{ value: "private", label: "Only me" }, { value: "approved_employers", label: "Shareable" }]} defaultValue="approved_employers" />
              <SubmitButton variant="secondary">Add link</SubmitButton>
            </ActionForm>
          </Card>
        </div>
      </div>
    </div>
  );
}
