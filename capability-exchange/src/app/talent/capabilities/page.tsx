import type { Metadata } from "next";
import { requireTalent } from "@/server/auth/current";
import { getOwnProfile, listCapabilityTaxonomy } from "@/server/services/profile";
import { buildProfileView } from "@/server/services/profile-view";
import { ActionForm, InlineAction, RadioGroup, SelectField, SubmitButton, TextField } from "@/components/forms";
import { Card, EmptyState, PageHeader, VisibilityBadge, Badge } from "@/components/ui";
import { capabilityCategories, capabilityTiers, labelOf, proficiencyLevels } from "@/config/taxonomy";
import { removeCapabilityAction, saveCapabilityAction } from "../actions";

export const metadata: Metadata = { title: "Capabilities" };

export default async function CapabilitiesPage() {
  const actor = await requireTalent();
  const profile = await getOwnProfile(actor);
  const [view, taxonomy] = await Promise.all([buildProfileView(profile, { kind: "owner" }), listCapabilityTaxonomy()]);
  return (
    <div>
      <PageHeader
        eyebrow="Capability stack"
        title="Capabilities"
        description="What you can do, in three tiers. Category describes the kind of capability; proficiency is your own rating. If a reviewer ever assesses a capability, that is shown separately."
      />
      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          {view.capabilities.length === 0 && <EmptyState title="No capabilities yet">Add two to four core capabilities first: the things you are known for.</EmptyState>}
          {capabilityTiers.map((tier) => {
            const items = view.capabilities.filter((c) => c.tier === tier.value);
            if (!items.length) return null;
            return (
              <Card key={tier.value}>
                <h2 className="text-xl">{tier.label}</h2>
                <p className="text-sm text-ink-muted">{tier.help}</p>
                <ul className="mt-4 divide-y divide-line">
                  {items.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div>
                        <p className="font-semibold">{c.name}</p>
                        <p className="text-sm text-ink-muted">
                          {labelOf(capabilityCategories, c.category)} · {labelOf(proficiencyLevels, c.selfProficiency)} (self-rated)
                          {c.assessedProficiency && ` · ${labelOf(proficiencyLevels, c.assessedProficiency)} (assessed)`}
                          {c.yearsExperience != null && ` · ${c.yearsExperience} years`}
                        </p>
                        <div className="mt-1 flex gap-2">
                          <VisibilityBadge visibility={c.visibility} />
                          {view.engagements.some((e) => e.capabilities.some((x) => x.id === c.capabilityId)) ? <Badge tone="success">Has an example</Badge> : <Badge>No example yet</Badge>}
                        </div>
                      </div>
                      <InlineAction action={removeCapabilityAction} hidden={{ id: c.id }} variant="ghost" confirm={`Remove ${c.name}?`}>
                        Remove
                      </InlineAction>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
        <Card className="lg:sticky lg:top-6 lg:self-start">
          <h2 className="text-xl">Add or update a capability</h2>
          <p className="mt-1 text-sm text-ink-muted">Adding one you already have updates it.</p>
          <ActionForm action={saveCapabilityAction} className="mt-4" aria-label="Add a capability">
            <TextField name="name" label="Capability" required list="capability-names" hint="Start typing to see common names, so employers can find it." />
            <datalist id="capability-names">
              {taxonomy.map((t) => (
                <option key={t.id} value={t.name} />
              ))}
            </datalist>
            <p className="text-xs text-ink-soft">Suggestions include: {taxonomy.slice(0, 8).map((t) => t.name).join(", ")}…</p>
            <SelectField name="category" label="Category" required options={capabilityCategories} defaultValue="functional" />
            <RadioGroup name="tier" label="Tier" required options={capabilityTiers} defaultValue="strong" />
            <SelectField name="selfProficiency" label="Your proficiency" required placeholder="Choose a level" options={proficiencyLevels.map((p) => ({ value: p.value, label: `${p.label}: ${p.help}` }))} />
            <TextField name="yearsExperience" label="Years using it" inputMode="numeric" />
            <TextField name="evidenceNote" label="One line of supporting context" maxLength={200} />
            <SelectField name="visibility" label="Who can see it" required options={[{ value: "approved_employers", label: "Anyone I share my profile with" }, { value: "private", label: "Only me" }]} defaultValue="approved_employers" />
            <SubmitButton>Save capability</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </div>
  );
}
