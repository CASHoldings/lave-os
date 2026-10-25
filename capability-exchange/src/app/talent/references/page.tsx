import type { Metadata } from "next";
import { requireTalent } from "@/server/auth/current";
import { getOwnProfile } from "@/server/services/profile";
import { buildProfileView } from "@/server/services/profile-view";
import { RecordsPage } from "@/components/records-page";
import { Checkbox, SelectField, TextAreaField, TextField } from "@/components/forms";
import { Badge } from "@/components/ui";

export const metadata: Metadata = { title: "References" };

export default async function ReferencesPage() {
  const actor = await requireTalent();
  const view = await buildProfileView(await getOwnProfile(actor), { kind: "owner" });
  return (
    <RecordsPage
      kind="referee"
      eyebrow="Module 15"
      title="References"
      description="People who can speak to specific parts of your work. Contact details are always private: employers never see them unless you grant permission, and nobody contacts a reference without your consent. The platform's assistant never contacts references."
      items={view.referees}
      emptyTitle="No references yet"
      addLabel="Add a reference"
      renderItem={(r) => (
        <>
          <p className="font-semibold">{r.name}</p>
          <p className="text-sm text-ink-muted">{[r.relationship, r.organisation].filter(Boolean).join(", ")}</p>
          {r.speaksTo && <p className="mt-1 text-sm">Can speak to: {r.speaksTo}</p>}
          {r.contact && <p className="mt-1 text-sm text-ink-muted">{[r.contact.email, r.contact.phone].filter(Boolean).join(" · ")} (private)</p>}
          <div className="mt-2">
            <Badge tone={r.consentToContact ? "success" : "neutral"}>{r.consentToContact ? "You consent to them being contacted" : "Not to be contacted"}</Badge>
          </div>
        </>
      )}
      renderFields={(r) => (
        <>
          <TextField name="name" label="Name" required defaultValue={r?.name} />
          <TextField name="relationship" label="Relationship" required defaultValue={r?.relationship} placeholder="e.g. Former manager at a utility" />
          <TextField name="organisation" label="Organisation" defaultValue={r?.organisation} />
          <TextField name="email" label="Email (private)" type="email" defaultValue={r?.contact?.email} />
          <TextField name="phone" label="Phone (private)" type="tel" defaultValue={r?.contact?.phone} />
          <TextAreaField name="speaksTo" label="Best placed to speak to" rows={2} defaultValue={r?.speaksTo} />
          <Checkbox name="consentToContact" label="I consent to this reference being contacted by organisations I grant permission to" defaultChecked={r?.consentToContact} />
          <SelectField
            name="visibility"
            label="Show name and relationship"
            required
            options={[
              { value: "private", label: "Only me" },
              { value: "approved_employers", label: "To anyone I share my profile with (never contact details)" },
            ]}
            defaultValue={r?.visibility ?? "private"}
          />
        </>
      )}
    />
  );
}
