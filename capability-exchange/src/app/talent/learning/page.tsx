import type { Metadata } from "next";
import { requireTalent } from "@/server/auth/current";
import { getOwnProfile } from "@/server/services/profile";
import { buildProfileView } from "@/server/services/profile-view";
import { RecordsPage } from "@/components/records-page";
import { SelectField, TextAreaField, TextField } from "@/components/forms";
import { VerificationBadge } from "@/components/ui";
import { labelOf, learningKinds } from "@/config/taxonomy";

export const metadata: Metadata = { title: "Learning and development" };

export default async function LearningPage() {
  const actor = await requireTalent();
  const view = await buildProfileView(await getOwnProfile(actor), { kind: "owner" });
  return (
    <RecordsPage
      kind="learning"
      eyebrow="Module 6"
      title="Learning and development"
      description="Courses, credentials and self-directed study from the past few years, with what you took from each."
      items={view.learning}
      emptyTitle="No learning records yet"
      addLabel="Add a learning record"
      renderItem={(l) => (
        <>
          <p className="font-semibold">{l.title}</p>
          <p className="text-sm text-ink-muted">{[labelOf(learningKinds, l.kind), l.provider, l.year].filter(Boolean).join(" · ")}</p>
          {l.takeaway && <p className="mt-1 text-sm">{l.takeaway}</p>}
          <div className="mt-2">
            <VerificationBadge status={l.verificationStatus as "self_reported"} />
          </div>
        </>
      )}
      renderFields={(l) => (
        <>
          <SelectField name="kind" label="Type" required options={learningKinds} defaultValue={l?.kind ?? "course"} />
          <TextField name="title" label="Title" required defaultValue={l?.title} />
          <TextField name="provider" label="Provider" defaultValue={l?.provider} />
          <TextField name="year" label="Year" inputMode="numeric" defaultValue={l?.year} />
          <TextAreaField name="takeaway" label="What you took from it" rows={3} defaultValue={l?.takeaway} />
          <TextField name="credentialUrl" label="Credential link" type="url" defaultValue={l?.credentialUrl} placeholder="https://" />
          <SelectField name="visibility" label="Who can see it" required options={[{ value: "approved_employers", label: "Anyone I share my profile with" }, { value: "private", label: "Only me" }]} defaultValue={l?.visibility ?? "approved_employers"} />
        </>
      )}
    />
  );
}
