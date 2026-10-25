import Link from "next/link";
import type { Metadata } from "next";
import { requireTalent } from "@/server/auth/current";
import { coreSteps, getOwnProfile, moduleProgress } from "@/server/services/profile";
import { AutosaveForm } from "@/components/autosave-form";
import { ActionForm, CheckboxGroup, RadioGroup, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/forms";
import { Alert, Badge, ButtonLink, Card, PageHeader } from "@/components/ui";
import {
  availabilityStatuses,
  compensationPeriods,
  currencies,
  opportunityTypes,
  profileModules,
  relocationOptions,
  roleFamilies,
  sectors,
  workArrangements,
} from "@/config/taxonomy";
import { brand } from "@/config/brand";
import { saveSectionAction, updateVisibilityAction } from "../actions";

export const metadata: Metadata = { title: "Edit your profile" };

const visibilityOptions = [
  { value: "private", label: "Only me" },
  { value: "approved_employers", label: "Approved employers" },
];

export default async function ProfileEditorPage({ searchParams }: PageProps<"/talent/profile">) {
  const actor = await requireTalent();
  const { welcome } = await searchParams;
  const profile = await getOwnProfile(actor);
  const steps = await coreSteps(profile);
  const progress = await moduleProgress(profile.id);
  const done = steps.filter((s) => s.done).length;
  const save = (section: string) => saveSectionAction.bind(null, section);

  return (
    <div>
      <PageHeader
        eyebrow={brand.modules.profile.name}
        title="Your core profile"
        description="Start with the essentials. Everything saves as you go, so you can stop and come back at any time."
        actions={
          <>
            <ButtonLink href="/talent/profile/preview" variant="secondary">
              Preview
            </ButtonLink>
            <ButtonLink href="/talent/portfolio">Evidence Portfolio</ButtonLink>
          </>
        }
      />
      {welcome && (
        <Alert tone="success" title="Welcome. Your draft profile has been created." className="mb-6">
          It is private. Fill in what you can now; missing answers are shown as “not provided”, never as a weakness.
        </Alert>
      )}
      <div className="grid gap-8 lg:grid-cols-[1fr_18rem]">
        <div className="space-y-6">
          <Card id="basics">
            <h2 className="mb-4 text-xl">Name and headline</h2>
            <AutosaveForm save={save("basics")} label="Name and headline">
              <TextField name="fullName" label="Full name" required defaultValue={profile.fullName} autoComplete="name" />
              <TextField name="preferredName" label="Preferred name" defaultValue={profile.preferredName} />
              <TextField name="headline" label="Professional headline" defaultValue={profile.headline} maxLength={140} hint="One line on what you do, for example “Infrastructure finance lead: ports and power”." />
              <SelectField name="roleFamily" label="Main professional area" options={roleFamilies} defaultValue={profile.roleFamily} hint="Used only to suggest relevant prompts. It never affects who sees you." />
              <TextField name="yearsExperience" label="Years of professional experience" inputMode="numeric" defaultValue={profile.yearsExperience} />
            </AutosaveForm>
          </Card>

          <Card id="location">
            <h2 className="mb-4 text-xl">Location, time zone and languages</h2>
            <AutosaveForm save={save("location")} label="Location, time zone and languages">
              <div className="grid gap-5 sm:grid-cols-2">
                <TextField name="locationCity" label="City or region" defaultValue={profile.locationCity} hint="A general location is enough." />
                <TextField name="locationCountry" label="Country" defaultValue={profile.locationCountry} />
              </div>
              <TextField name="timeZone" label="Time zone" defaultValue={profile.timeZone} placeholder="e.g. WAT (UTC+1)" />
              <TextField name="languages" label="Working languages" defaultValue={profile.languages.join(", ")} hint="Separate with commas." />
            </AutosaveForm>
          </Card>

          <Card id="introduction">
            <h2 className="mb-4 text-xl">Professional introduction</h2>
            <AutosaveForm save={save("introduction")} label="Professional introduction">
              <TextAreaField
                name="introduction"
                label="Introduction"
                rows={6}
                defaultValue={profile.introduction}
                maxLength={2500}
                hint="Two to four sentences: what you do, for whom, and what you are known for. Specific beats impressive."
              />
              <CheckboxGroup name="sectors" label="Sectors you have worked in" options={sectors.map((s) => ({ value: s, label: s }))} defaultValue={profile.sectors} />
            </AutosaveForm>
          </Card>

          <Card id="preferences">
            <h2 className="mb-4 text-xl">Opportunities you want</h2>
            <AutosaveForm save={save("preferences")} label="Opportunities you want">
              <CheckboxGroup name="opportunityTypes" label="Types of opportunity" options={opportunityTypes} defaultValue={profile.opportunityTypes} />
              <CheckboxGroup name="workArrangements" label="Working arrangements" options={workArrangements} defaultValue={profile.workArrangements} />
              <SelectField name="relocation" label="Relocation" options={relocationOptions} defaultValue={profile.relocation} />
              <TextAreaField name="geographicPreferences" label="Geographical preferences" rows={2} defaultValue={profile.geographicPreferences} />
            </AutosaveForm>
          </Card>

          <Card id="availability">
            <h2 className="mb-4 text-xl">Availability</h2>
            <AutosaveForm save={save("availability")} label="Availability">
              <RadioGroup name="availabilityStatus" label="Current availability" options={availabilityStatuses} defaultValue={profile.availabilityStatus} />
              <div className="grid gap-5 sm:grid-cols-3">
                <TextField name="availableFrom" label="Available from" type="date" defaultValue={profile.availableFrom} />
                <TextField name="noticePeriodWeeks" label="Notice period (weeks)" inputMode="numeric" defaultValue={profile.noticePeriodWeeks} />
                <TextField name="hoursPerWeek" label="Hours a week (fractional)" inputMode="numeric" defaultValue={profile.hoursPerWeek} />
              </div>
            </AutosaveForm>
          </Card>

          <Card id="compensation">
            <h2 className="mb-1 text-xl">Compensation or day rate</h2>
            <p className="mb-4 text-sm text-ink-muted">Optional. Kept private unless you choose to share it. If shared, it is only compared with budgets in the same currency and period.</p>
            <AutosaveForm save={save("compensation")} label="Compensation">
              <div className="grid gap-5 sm:grid-cols-2">
                <SelectField name="compensationCurrency" label="Currency" options={currencies.map((c) => ({ value: c, label: c }))} defaultValue={profile.compensationCurrency} />
                <SelectField name="compensationPeriod" label="Period" options={compensationPeriods} defaultValue={profile.compensationPeriod} />
                <TextField name="compensationMin" label="From" inputMode="decimal" defaultValue={profile.compensationMin ? Number(profile.compensationMin) : null} />
                <TextField name="compensationMax" label="To" inputMode="decimal" defaultValue={profile.compensationMax ? Number(profile.compensationMax) : null} />
              </div>
              <RadioGroup name="compensationVisibility" label="Who can see this" options={visibilityOptions} defaultValue={profile.compensationVisibility} />
            </AutosaveForm>
          </Card>

          <Card id="contact">
            <h2 className="mb-1 text-xl">Contact details and links</h2>
            <p className="mb-4 text-sm text-ink-muted">Who sees your email and phone is controlled under sharing settings below.</p>
            <AutosaveForm save={save("contact")} label="Contact details">
              <div className="grid gap-5 sm:grid-cols-2">
                <TextField name="contactEmail" label="Contact email" type="email" defaultValue={profile.contactEmail} />
                <TextField name="contactPhone" label="Phone" type="tel" defaultValue={profile.contactPhone} />
              </div>
              <TextField name="linkedinUrl" label="Professional profile link" type="url" defaultValue={profile.linkedinUrl} placeholder="https://" />
              <TextField name="websiteUrl" label="Website or portfolio" type="url" defaultValue={profile.websiteUrl} placeholder="https://" />
            </AutosaveForm>
          </Card>

          <Card id="sharing">
            <h2 className="mb-1 text-xl">Who can see your profile</h2>
            <p className="mb-4 text-sm text-ink-muted">Approved employers are organisations a platform administrator has reviewed. Each item in your profile can also be kept private on its own.</p>
            <ActionForm action={updateVisibilityAction} aria-label="Sharing settings">
              <RadioGroup
                name="visibility"
                label="Profile"
                options={[
                  { value: "private", label: "Private", help: "Only you. You can still share links and apply to opportunities." },
                  { value: "approved_employers", label: "Discoverable by approved employers", help: "Appears in talent search with the items you have marked as shareable." },
                ]}
                defaultValue={profile.visibility}
              />
              <RadioGroup
                name="contactVisibility"
                label="Email and phone"
                options={[
                  { value: "private", label: "Never shown" },
                  { value: "on_introduction", label: "Only to organisations whose introduction request I accept" },
                  { value: "approved_employers", label: "All approved employers who can see my profile" },
                ]}
                defaultValue={profile.contactVisibility}
              />
              <RadioGroup
                name="evidenceVisibility"
                label="Evidence files and links"
                options={[
                  { value: "private", label: "Private", help: "Employers see that evidence exists, not the files." },
                  { value: "approved_employers", label: "Items I mark as shareable", help: "Employers can open evidence items you have marked as shareable." },
                ]}
                defaultValue={profile.evidenceVisibility}
              />
              <SubmitButton>Save sharing settings</SubmitButton>
            </ActionForm>
          </Card>
        </div>

        <aside className="space-y-6 lg:sticky lg:top-6 lg:self-start" aria-label="Profile progress">
          <Card>
            <h2 className="text-lg">Core profile</h2>
            <p className="mt-1 text-sm text-ink-muted">
              {done} of {steps.length} complete
            </p>
            <ul className="mt-3 space-y-2 text-sm">
              {steps.map((s) => (
                <li key={s.key} className="flex gap-2">
                  <span aria-hidden="true" className={s.done ? "text-success" : "text-ink-soft"}>
                    {s.done ? "✓" : "○"}
                  </span>
                  <Link href={s.href}>{s.label}</Link>
                  <span className="sr-only">{s.done ? "(done)" : "(to do)"}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <h2 className="text-lg">Go deeper (optional)</h2>
            <p className="mt-1 text-sm text-ink-muted">Add modules when they help. None are required.</p>
            <ul className="mt-3 space-y-1 text-sm">
              {profileModules.map((m) => (
                <li key={m.key} className="flex items-center justify-between gap-2">
                  <Link href={`/talent/profile/modules/${m.key}`}>
                    {m.number}. {m.title}
                  </Link>
                  {progress[m.key] ? <Badge tone="accent">{progress[m.key]}</Badge> : null}
                </li>
              ))}
            </ul>
          </Card>
        </aside>
      </div>
    </div>
  );
}
