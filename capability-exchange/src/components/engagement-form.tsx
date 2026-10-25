import type { ViewEngagement } from "@/server/services/profile-view";
import { ActionForm, Checkbox, CheckboxGroup, RadioGroup, SelectField, SubmitButton, TextAreaField, TextField } from "./forms";
import { currencies, engagementKinds, engagementStages, ventureStages } from "@/config/taxonomy";
import { saveEngagementAction } from "@/app/talent/actions";

export function EngagementForm({ engagement, kind, capabilities }: { engagement?: ViewEngagement; kind?: string; capabilities: { capabilityId: string; name: string }[] }) {
  const e = engagement;
  const money = (v: string | null | undefined) => (v ? Number(v) : null);
  return (
    <ActionForm action={saveEngagementAction} aria-label="Project or role details">
      {e && <input type="hidden" name="engagementId" value={e.id} />}
      <fieldset className="space-y-5">
        <legend className="mb-2 font-serif text-xl">The basics</legend>
        <SelectField name="kind" label="Type" required options={engagementKinds} defaultValue={e?.kind ?? kind ?? "project"} />
        <TextField name="title" label="Name" required defaultValue={e?.title} hint="A short title, e.g. “Container terminal expansion financing”." />
        <RadioGroup
          name="confidentiality"
          label="How should the organisation or client be shown?"
          defaultValue={e?.confidentiality ?? "named"}
          options={[
            { value: "named", label: "Name it" },
            { value: "anonymised", label: "Describe it without naming it", help: "Others see your description only. The name stays visible to you." },
          ]}
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField name="organisationName" label="Organisation or client" defaultValue={e?.organisationName} />
          <TextField name="anonymisedDescription" label="Anonymised description" defaultValue={e?.confidentiality === "anonymised" ? e.organisationLabel : null} placeholder="e.g. a West African port operator" />
          <TextField name="roleTitle" label="Your role or title" defaultValue={e?.roleTitle} />
          <TextField name="sector" label="Sector" defaultValue={e?.sector} />
          <TextField name="country" label="Country or region" defaultValue={e?.country} />
          <TextField name="teamSize" label="Team size" inputMode="numeric" defaultValue={e?.teamSize} />
          <TextField name="startDate" label="Start date" type="date" defaultValue={e?.startDate} />
          <TextField name="endDate" label="End date" type="date" defaultValue={e?.endDate} />
        </div>
        <Checkbox name="isCurrent" label="I am still involved" defaultChecked={e?.isCurrent} />
        <SelectField
          name="status"
          label="Status"
          required
          options={[
            { value: "ongoing", label: "Ongoing" },
            { value: "completed", label: "Completed" },
            { value: "paused", label: "Paused" },
            { value: "discontinued", label: "Discontinued" },
          ]}
          defaultValue={e?.status ?? "completed"}
        />
        <SelectField
          name="stageReached"
          label="Furthest stage reached while you were involved"
          options={engagementStages}
          defaultValue={e?.stageReached}
          hint="For deals and projects: introduction, proposal, contract award, execution or completion. Be precise. “Introduced” is not “delivered”."
        />
        <SelectField name="ventureStage" label="Venture stage (for ventures)" options={ventureStages} defaultValue={e?.ventureStage} />
      </fieldset>

      <fieldset className="space-y-5 border-t border-line pt-6">
        <legend className="mb-2 font-serif text-xl">What happened</legend>
        <TextAreaField name="context" label="Context" rows={3} defaultValue={e?.context} hint="What was the situation, challenge or opportunity?" />
        <TextAreaField name="responsibility" label="Your responsibility" rows={3} defaultValue={e?.responsibility} hint="What were you accountable for?" />
        <TextAreaField name="individualActions" label="What you did personally" rows={5} defaultValue={e?.individualActions} hint="Use “I”. Be specific about your own actions and decisions." />
        <TextAreaField name="teamContribution" label="What the team or others did" rows={3} defaultValue={e?.teamContribution} />
        <TextAreaField name="outcomes" label="Outcomes" rows={4} defaultValue={e?.outcomes} hint="What changed? If it did not finish, say how far it got." />
        <TextAreaField name="lessons" label="Lessons learned" rows={3} defaultValue={e?.lessons} hint="Including from what did not work." />
      </fieldset>

      <fieldset className="space-y-5 border-t border-line pt-6">
        <legend className="mb-2 font-serif text-xl">Figures (optional)</legend>
        <p className="text-sm text-ink-muted">Keep these apart: the size of a project is not the revenue it generated, and neither is the value you personally drove.</p>
        <SelectField name="valueCurrency" label="Currency" options={currencies.map((c) => ({ value: c, label: c }))} defaultValue={e?.valueCurrency} />
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField name="projectValue" label="Overall project or deal value" inputMode="decimal" defaultValue={money(e?.projectValue)} />
          <TextField name="revenueGenerated" label="Revenue generated" inputMode="decimal" defaultValue={money(e?.revenueGenerated)} />
          <TextField name="budgetManaged" label="Budget you managed" inputMode="decimal" defaultValue={money(e?.budgetManaged)} />
          <TextField name="personallyAttributableValue" label="Value attributable to you" inputMode="decimal" defaultValue={money(e?.personallyAttributableValue)} />
        </div>
        <TextAreaField name="valueNotes" label="Notes on the figures" rows={2} defaultValue={e?.valueNotes} hint="How were they calculated? What is and is not yours?" />
      </fieldset>

      <fieldset className="space-y-5 border-t border-line pt-6">
        <legend className="mb-2 font-serif text-xl">Capabilities and sharing</legend>
        {capabilities.length ? (
          <CheckboxGroup
            name="capabilityIds"
            label="Capabilities this demonstrates"
            options={capabilities.map((c) => ({ value: c.capabilityId, label: c.name }))}
            defaultValue={e?.capabilities.map((c) => c.id) ?? []}
          />
        ) : (
          <p className="text-sm text-ink-muted">Add capabilities to your profile to link them here.</p>
        )}
        <Checkbox name="isSignature" label="Mark as a signature project" hint="Your three to five most representative pieces of work." defaultChecked={e?.isSignature} />
        <RadioGroup
          name="visibility"
          label="Who can see this record"
          defaultValue={e?.visibility ?? "approved_employers"}
          options={[
            { value: "approved_employers", label: "Anyone I share my profile with" },
            { value: "private", label: "Only me", help: "Its claims are hidden too." },
          ]}
        />
        <TextAreaField name="privateNotes" label="Private notes" rows={2} defaultValue={e?.privateNotes} hint="Only ever visible to you." />
      </fieldset>
      <SubmitButton>{e ? "Save changes" : "Save project"}</SubmitButton>
    </ActionForm>
  );
}
