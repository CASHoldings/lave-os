import Link from "next/link";
import type { Metadata } from "next";
import { requireEmployer } from "@/server/auth/current";
import { primaryMembership, canDiscoverTalent } from "@/server/policy/actor";
import { listOrganisationOpportunities } from "@/server/services/employer";
import { listOrganisationApplications, listOrganisationIntroductions, listShortlists } from "@/server/services/applications";
import { Alert, Badge, ButtonLink, Card, EmptyState, PageHeader, formatDate } from "@/components/ui";
import { applicationStatuses, labelOf } from "@/config/taxonomy";

export const metadata: Metadata = { title: "Employer dashboard" };

export default async function EmployerDashboard({ searchParams }: PageProps<"/employer">) {
  const actor = await requireEmployer();
  const { registered } = await searchParams;
  const m = primaryMembership(actor)!;
  const approved = canDiscoverTalent(actor);
  const [opps, apps, intros, lists] = await Promise.all([
    listOrganisationOpportunities(actor, m.organisationId),
    listOrganisationApplications(actor),
    listOrganisationIntroductions(actor),
    approved ? listShortlists(actor) : Promise.resolve([]),
  ]);
  const published = opps.filter((o) => o.status === "published");
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={m.organisationName}
        title="Employer dashboard"
        actions={
          <>
            {approved && <ButtonLink href="/employer/search" variant="secondary">Find talent</ButtonLink>}
            <ButtonLink href="/employer/opportunities/new">New opportunity</ButtonLink>
          </>
        }
      />
      {registered && <Alert tone="success" title="Organisation submitted for review">We will review it shortly. You can draft opportunities in the meantime.</Alert>}
      {m.organisationStatus === "pending" && (
        <Alert tone="warning" title="Awaiting approval">An administrator is reviewing your organisation. Talent search and publishing open once it is approved.</Alert>
      )}
      {(m.organisationStatus === "rejected" || m.organisationStatus === "suspended") && (
        <Alert tone="error" title={`Organisation ${m.organisationStatus}`}>Talent search and publishing are unavailable. Contact the platform team if you think this is a mistake.</Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-4">
        {[
          ["Published opportunities", published.length, "/employer/opportunities"],
          ["Applications", apps.length, "/employer/opportunities"],
          ["Shortlists", lists.length, "/employer/shortlists"],
          ["Introductions accepted", intros.filter((i) => i.request.status === "accepted").length, "#intros"],
        ].map(([label, n, href]) => (
          <Card key={label as string}>
            <p className="text-3xl font-semibold">{n}</p>
            <Link href={href as string} className="text-sm">{label}</Link>
          </Card>
        ))}
      </div>
      <section aria-labelledby="recent-h">
        <h2 id="recent-h" className="text-2xl">Recent applications</h2>
        {apps.length === 0 ? (
          <div className="mt-4"><EmptyState title="No applications yet">Applications arrive once an opportunity is published.</EmptyState></div>
        ) : (
          <ul className="mt-4 space-y-2">
            {apps.slice(0, 8).map(({ application: a, opportunityTitle }) => (
              <Card as="li" key={a.id} className="flex flex-wrap items-center justify-between gap-2 !py-4">
                <span>
                  <Link href={`/employer/applications/${a.id}`} className="font-semibold">{a.candidateDisplayName}</Link>
                  <span className="text-sm text-ink-muted"> · {opportunityTitle} · {formatDate(a.createdAt)}</span>
                </span>
                <Badge tone={a.status === "withdrawn" ? "neutral" : "accent"}>{labelOf(applicationStatuses, a.status)}</Badge>
              </Card>
            ))}
          </ul>
        )}
      </section>
      <section id="intros" aria-labelledby="intros-h">
        <h2 id="intros-h" className="text-2xl">Introduction requests</h2>
        {intros.length === 0 ? (
          <div className="mt-4"><EmptyState title="No introduction requests sent" /></div>
        ) : (
          <ul className="mt-4 space-y-2">
            {intros.map(({ request, candidateName }) => (
              <Card as="li" key={request.id} className="flex flex-wrap items-center justify-between gap-2 !py-4">
                <span>
                  {request.status === "accepted" ? <Link href={`/employer/talent/${request.profileId}`}>{candidateName}</Link> : candidateName}
                  <span className="text-sm text-ink-muted"> · sent {formatDate(request.createdAt)}</span>
                </span>
                <Badge tone={request.status === "accepted" ? "success" : request.status === "pending" ? "info" : "neutral"}>{request.status}</Badge>
              </Card>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
