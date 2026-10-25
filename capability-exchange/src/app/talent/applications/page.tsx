import Link from "next/link";
import type { Metadata } from "next";
import { requireTalent } from "@/server/auth/current";
import { listMyApplications } from "@/server/services/applications";
import { Badge, ButtonLink, Card, EmptyState, PageHeader, formatDate } from "@/components/ui";
import { applicationStatuses, labelOf } from "@/config/taxonomy";

export const metadata: Metadata = { title: "Applications" };

export default async function ApplicationsPage() {
  const actor = await requireTalent();
  const apps = await listMyApplications(actor);
  return (
    <div>
      <PageHeader title="Your applications" description="Each application shares a fixed copy of your profile. You can withdraw at any time." actions={<ButtonLink href="/opportunities">Find opportunities</ButtonLink>} />
      {apps.length === 0 ? (
        <EmptyState title="No applications yet" action={<ButtonLink href="/opportunities">Browse opportunities</ButtonLink>} />
      ) : (
        <ul className="space-y-3">
          {apps.map(({ application: a, opportunity, organisationName }) => (
            <Card as="li" key={a.id} className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <Link href={`/talent/applications/${a.id}`} className="font-semibold">
                  {opportunity.title}
                </Link>
                <p className="text-sm text-ink-muted">
                  {organisationName} · applied {formatDate(a.createdAt)} · updated {formatDate(a.updatedAt)}
                </p>
              </div>
              <Badge tone={a.status === "withdrawn" || a.status === "not_progressing" ? "neutral" : "accent"}>{labelOf(applicationStatuses, a.status)}</Badge>
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}
