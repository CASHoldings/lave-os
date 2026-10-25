import type { OpportunityRow } from "@/server/services/employer";
import { ActionForm, CheckboxGroup, SelectField, SubmitButton, TextAreaField, TextField } from "./forms";
import { compensationPeriods, currencies, opportunityTypes, sectors, workArrangements } from "@/config/taxonomy";
import { saveOpportunityAction } from "@/app/employer/actions";

export function OpportunityForm({ o }: { o?: OpportunityRow }) {
  return (
    <ActionForm action={saveOpportunityAction} aria-label="Opportunity details">
      {o && <input type="hidden" name="opportunityId" value={o.id} />}
      <fieldset className="space-y-5">
        <legend className="mb-2 font-serif text-xl">The opportunity</legend>
        <TextField name="title" label="Title" required defaultValue={o?.title} />
        <SelectField name="engagementType" label="Type of engagement" required options={opportunityTypes} defaultValue={o?.engagementType ?? "permanent"} />
        <TextAreaField name="problemStatement" label="The problem to solve" rows={4} defaultValue={o?.problemStatement} hint="Required before publishing. Describe the situation, not the ideal person." />
        <TextAreaField name="expectedOutcomes" label="Expected outcomes" rows={3} defaultValue={o?.expectedOutcomes} hint="Required before publishing. What will be different in 6 to 18 months?" />
        <TextAreaField name="responsibilities" label="Responsibilities or deliverables" rows={4} defaultValue={o?.responsibilities} />
        <TextAreaField name="experienceRequirements" label="Experience requirements" rows={3} defaultValue={o?.experienceRequirements} hint="Describe the experience needed, not years or age. Avoid requirements that exclude people for reasons unrelated to the work." />
        <TextAreaField name="requiredEvidence" label="Evidence you would like to see" rows={2} defaultValue={o?.requiredEvidence} />
        <CheckboxGroup name="sectors" label="Sectors" options={sectors.map((s) => ({ value: s, label: s }))} defaultValue={o?.sectors ?? []} />
      </fieldset>
      <fieldset className="space-y-5 border-t border-line pt-6">
        <legend className="mb-2 font-serif text-xl">Where, when and how much</legend>
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField name="locationText" label="Location" defaultValue={o?.locationText} />
          <TextField name="country" label="Country" defaultValue={o?.country} />
          <SelectField name="workArrangement" label="Working arrangement" options={workArrangements} defaultValue={o?.workArrangement} />
          <TextField name="timeZoneRequirements" label="Time zone needs" defaultValue={o?.timeZoneRequirements} />
          <TextField name="startDate" label="Start date" type="date" defaultValue={o?.startDate} />
          <TextField name="durationText" label="Duration" defaultValue={o?.durationText} placeholder="e.g. 6 months" />
          <TextField name="hoursPerWeek" label="Hours a week" inputMode="numeric" defaultValue={o?.hoursPerWeek} />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <SelectField name="compensationCurrency" label="Currency" options={currencies.map((c) => ({ value: c, label: c }))} defaultValue={o?.compensationCurrency} />
          <SelectField name="compensationPeriod" label="Period" options={compensationPeriods} defaultValue={o?.compensationPeriod} />
          <TextField name="compensationMin" label="Budget from" inputMode="decimal" defaultValue={o?.compensationMin ? Number(o.compensationMin) : null} />
          <TextField name="compensationMax" label="Budget to" inputMode="decimal" defaultValue={o?.compensationMax ? Number(o.compensationMax) : null} />
        </div>
        <TextField name="selectionStages" label="Selection stages" defaultValue={o?.selectionStages.join(", ")} hint="Separate with commas, in order, e.g. “Profile review, Conversation, Case discussion”." />
      </fieldset>
      <SubmitButton>{o ? "Save changes" : "Save draft"}</SubmitButton>
    </ActionForm>
  );
}
