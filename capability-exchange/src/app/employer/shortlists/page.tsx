import Link from "next/link";
import type { Metadata } from "next";
import { requireDiscoveryAccess } from "@/server/auth/current";
import { primaryMembership } from "@/server/policy/actor";
import { listShortlists } from "@/server/services/applications";
import { listOrganisationOpportunities } from "@/server/services/employer";
import { ActionForm, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/forms";
import { Card, EmptyState, PageHeader, formatDate } from "@/components/ui";
import { createShortlistAction } from "../actions";

export const metadata: Metadata = { title: "Shortlists" };

export default async function ShortlistsPage() {
  const actor = await requireDiscoveryAccess();
  const [lists, opps] = await Promise.all([listShortlists(actor), listOrganisationOpportunities(actor, primaryMembership(actor)!.organisationId)]);
  return (
    <div>
      <PageHeader title="Shortlists" description="Private to your organisation. People on a shortlist are not notified." />
      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div>
          {lists.length === 0 ? (
            <EmptyState title="No shortlists yet">Create one, then add people from search or their profile.</EmptyState>
          ) : (
            <ul className="space-y-3">
              {lists.map((l) => (
                <Card as="li" key={l.id}>
                  <Link href={`/employer/shortlists/${l.id}`} className="text-lg font-semibold">{l.name}</Link>
                  <p className="text-sm text-ink-muted">{l.entryCount} {l.entryCount === 1 ? "person" : "people"} · created {formatDate(l.createdAt)}</p>
                  {l.description && <p className="mt-1 text-sm">{l.description}</p>}
                </Card>
              ))}
            </ul>
          )}
        </div>
        <Card className="lg:self-start">
          <h2 className="text-lg">New shortlist</h2>
          <ActionForm action={createShortlistAction} className="mt-3" resetOnSuccess aria-label="Create a shortlist">
            <TextField name="name" label="Name" required />
            <TextAreaField name="description" label="Purpose" rows={2} />
            <SelectField name="opportunityId" label="For opportunity" options={opps.map((o) => ({ value: o.id, label: o.title }))} />
            <SubmitButton>Create shortlist</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </div>
  );
}
