import type { Metadata } from "next";
import { requireEmployer } from "@/server/auth/current";
import { primaryMembership } from "@/server/policy/actor";
import { getOrganisation, listMembers } from "@/server/services/employer";
import { ActionForm, InlineAction, SelectField, SubmitButton, TextField } from "@/components/forms";
import { OrganisationFields } from "@/components/organisation-fields";
import { Badge, Card, PageHeader } from "@/components/ui";
import { addMemberAction, removeMemberAction, updateOrganisationAction } from "../actions";

export const metadata: Metadata = { title: "Organisation" };

export default async function TeamPage() {
  const actor = await requireEmployer();
  const m = primaryMembership(actor)!;
  const [org, members] = await Promise.all([getOrganisation(actor, m.organisationId), listMembers(actor, m.organisationId)]);
  const canManage = m.role !== "member";
  return (
    <div className="space-y-8">
      <PageHeader title={org.name} description={<span className="flex items-center gap-2">Status: <Badge tone={org.status === "approved" ? "success" : "warning"}>{org.status}</Badge></span>} />
      <div className="grid gap-8 lg:grid-cols-2">
        <Card>
          <h2 className="text-xl">Members</h2>
          <ul className="mt-3 divide-y divide-line">
            {members.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <span>
                  <span className="font-semibold">{u.displayName}</span> <span className="text-sm text-ink-muted">{u.email}</span>
                </span>
                <span className="flex items-center gap-2">
                  <Badge>{u.role}</Badge>
                  {canManage && u.role !== "owner" && (
                    <InlineAction action={removeMemberAction} hidden={{ membershipId: u.id }} variant="ghost" confirm={`Remove ${u.displayName}?`}>Remove</InlineAction>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {canManage && (
            <ActionForm action={addMemberAction} className="mt-4 border-t border-line pt-4" resetOnSuccess aria-label="Add a colleague">
              <TextField name="email" label="Colleague's email" type="email" required hint="They need an employer account first. Invitation emails are not available in this version." />
              <SelectField name="role" label="Role" required options={[{ value: "member", label: "Member" }, { value: "admin", label: "Admin (can manage members)" }]} defaultValue="member" />
              <SubmitButton variant="secondary">Add colleague</SubmitButton>
            </ActionForm>
          )}
        </Card>
        <Card>
          <h2 className="text-xl">Organisation details</h2>
          {canManage ? (
            <ActionForm action={updateOrganisationAction} className="mt-4" aria-label="Organisation details">
              <OrganisationFields org={org} />
              <SubmitButton>Save details</SubmitButton>
            </ActionForm>
          ) : (
            <p className="mt-2 text-sm text-ink-muted">Only owners and admins can edit these details.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
