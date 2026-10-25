import { SelectField, TextAreaField, TextField } from "./forms";
import { sectors } from "@/config/taxonomy";

type Org = { name?: string | null; website?: string | null; country?: string | null; sector?: string | null; sizeBand?: string | null; description?: string | null };

export function OrganisationFields({ org }: { org?: Org }) {
  return (
    <>
      <TextField name="name" label="Organisation name" required defaultValue={org?.name} autoComplete="organization" />
      <TextField name="website" label="Website" type="url" defaultValue={org?.website} placeholder="https://" hint="Helps the reviewer confirm your organisation." />
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField name="country" label="Country of registration" defaultValue={org?.country} />
        <SelectField name="sector" label="Sector" options={sectors.map((s) => ({ value: s, label: s }))} defaultValue={org?.sector} />
      </div>
      <SelectField
        name="sizeBand"
        label="Size"
        options={["1-10", "11-50", "51-250", "251-1000", "1000+"].map((s) => ({ value: s, label: `${s} people` }))}
        defaultValue={org?.sizeBand}
      />
      <TextAreaField name="description" label="About the organisation" rows={3} defaultValue={org?.description} hint="Shown to professionals on your opportunities." />
    </>
  );
}
