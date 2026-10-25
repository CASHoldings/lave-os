import Link from "next/link";
import type { Metadata } from "next";
import { requireEmployer } from "@/server/auth/current";
import { primaryMembership } from "@/server/policy/actor";
import { listOrganisationOpportunities } from "@/server/services/employer";
import { Badge, ButtonLink, Card, EmptyState, PageHeader, formatDate } from "@/components/ui";
import { labelOf, opportunityTypes } from "@/config/taxonomy";

export const metadata: Metadata = { title: "Your opportunities" };

const statusTone = { draft: "warning", published: "success", closed: "neutral" } as const;

export default async function EmployerOpportunitiesPage() {
  const actor = await requireEmployer();
  const opps = await listOrganisationOpportunities(actor, primaryMembership(actor)!.organisationId);
  return (
    <div>
      <PageHeader title="Your opportunities" actions={<ButtonLink href="/employer/opportunities/new">New opportunity</ButtonLink>} />
      {opps.length === 0 ? (
        <EmptyState title="No opportunities yet" action={<ButtonLink href="/employer/opportunities/new">Create your first opportunity</ButtonLink>}>Start with the problem you need solved.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {opps.map((o) => (
            <Card as="li" key={o.id} className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <Link href={`/employer/opportunities/${o.id}`} className="text-lg font-semibold">{o.title}</Link>
                <p className="text-sm text-ink-muted">
                  {labelOf(opportunityTypes, o.engagementType)} · updated {formatDate(o.updatedAt)} · {o.applicationCount} application{o.applicationCount === 1 ? "" : "s"}
                </p>
              </div>
              <Badge tone={statusTone[o.status]}>{o.status}</Badge>
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}
