import Link from "next/link";
import type { Metadata } from "next";
import { requireTalent } from "@/server/auth/current";
import { getMyApplication } from "@/server/services/applications";
import { ProfileDocument } from "@/components/profile-document";
import { InlineAction } from "@/components/forms";
import { Alert, Badge, Card, PageHeader, formatDate } from "@/components/ui";
import { applicationStatuses, labelOf } from "@/config/taxonomy";
import type { ProfileView } from "@/server/services/profile-view";
import { withdrawApplicationAction } from "../../actions";

export const metadata: Metadata = { title: "Application" };

export default async function ApplicationPage({ params, searchParams }: PageProps<"/talent/applications/[id]">) {
  const { id } = await params;
  const { submitted } = await searchParams;
  const actor = await requireTalent();
  const { application: a, opportunity, organisationName, snapshot, events } = await getMyApplication(actor, id);
  return (
    <div>
      <PageHeader eyebrow={organisationName} title={opportunity.title} description={<Badge tone="accent">{labelOf(applicationStatuses, a.status)}</Badge>} actions={<Link href="/talent/applications">← All applications</Link>} />
      {submitted && <Alert tone="success" className="mb-6" title="Application submitted">The organisation now has a fixed copy of the profile shown below.</Alert>}
      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card>
            <h2 className="text-xl">Your expression of interest</h2>
            <p className="mt-2 whitespace-pre-line">{a.expressionOfInterest}</p>
          </Card>
          {a.status === "withdrawn" ? (
            <Alert tone="info">You withdrew this application on {formatDate(a.withdrawnAt)}. The organisation can no longer see the profile you shared.</Alert>
          ) : snapshot ? (
            <section aria-labelledby="snap-h">
              <h2 id="snap-h" className="text-2xl">
                What you shared
              </h2>
              <p className="mb-4 mt-1 text-sm text-ink-muted">
                Copy taken {formatDate(snapshot.createdAt)}
                {snapshot.includeContact ? " · includes contact details" : " · contact details not included"}
                {snapshot.includeEvidence ? " · shareable evidence included" : ""}
              </p>
              <ProfileDocument view={snapshot.data as ProfileView} />
            </section>
          ) : null}
        </div>
        <aside className="space-y-4">
          <Card>
            <h2 className="text-lg">History</h2>
            <ol className="mt-3 space-y-2 text-sm">
              {events.map((e, i) => (
                <li key={i}>
                  {labelOf(applicationStatuses, e.toStatus)} <span className="text-ink-soft">· {formatDate(e.createdAt)}</span>
                </li>
              ))}
            </ol>
          </Card>
          {a.status !== "withdrawn" && (
            <Card>
              <h2 className="text-lg">Withdraw</h2>
              <p className="mt-1 text-sm text-ink-muted">The organisation keeps a record that you applied, but loses access to your profile copy and files.</p>
              <div className="mt-3">
                <InlineAction action={withdrawApplicationAction} hidden={{ applicationId: a.id }} variant="danger" confirm="Withdraw this application?">
                  Withdraw application
                </InlineAction>
              </div>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
