import type { Metadata } from "next";
import { requireTalent } from "@/server/auth/current";
import { getOwnProfile } from "@/server/services/profile";
import { buildProfileView } from "@/server/services/profile-view";
import { RecordsPage } from "@/components/records-page";
import { SelectField, TextAreaField, TextField } from "@/components/forms";
import { labelOf, publicWorkKinds } from "@/config/taxonomy";

export const metadata: Metadata = { title: "Public work" };

export default async function PublicWorkPage() {
  const actor = await requireTalent();
  const view = await buildProfileView(await getOwnProfile(actor), { kind: "owner" });
  return (
    <RecordsPage
      kind="publicWork"
      eyebrow="Module 12"
      title="Public work and portfolios"
      description="Writing, talks, code, communities and research. Depth and consistency matter more than audience size."
      items={view.publicWork}
      emptyTitle="No public work yet"
      addLabel="Add public work"
      renderItem={(p) => (
        <>
          <p className="font-semibold">{p.title}</p>
          <p className="text-sm text-ink-muted">{[labelOf(publicWorkKinds, p.kind), p.venue, p.year].filter(Boolean).join(" · ")}</p>
          {p.url && (
            <a href={p.url} target="_blank" rel="noopener noreferrer nofollow" className="text-sm break-all">
              {p.url}
            </a>
          )}
        </>
      )}
      renderFields={(p) => (
        <>
          <SelectField name="kind" label="Type" required options={publicWorkKinds} defaultValue={p?.kind ?? "writing"} />
          <TextField name="title" label="Title" required defaultValue={p?.title} />
          <TextField name="venue" label="Publication, event or platform" defaultValue={p?.venue} />
          <TextField name="url" label="Link" type="url" defaultValue={p?.url} placeholder="https://" />
          <TextField name="year" label="Year" inputMode="numeric" defaultValue={p?.year} />
          <TextAreaField name="description" label="Short description" rows={2} defaultValue={p?.description} />
          <SelectField name="visibility" label="Who can see it" required options={[{ value: "approved_employers", label: "Anyone I share my profile with" }, { value: "private", label: "Only me" }]} defaultValue={p?.visibility ?? "approved_employers"} />
        </>
      )}
    />
  );
}
