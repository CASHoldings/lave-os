import Link from "next/link";
import type { Metadata } from "next";
import { requireAdmin } from "@/server/auth/current";
import { verificationQueue } from "@/server/services/admin";
import { Alert, Card, EmptyState, PageHeader, VerificationBadge, formatDate } from "@/components/ui";

export const metadata: Metadata = { title: "Verification" };

export default async function VerificationQueuePage({ searchParams }: PageProps<"/admin/verification">) {
  const actor = await requireAdmin();
  const { reviewed } = await searchParams;
  const queue = await verificationQueue(actor);
  return (
    <div>
      <PageHeader title="Verification requests" description="Claims whose owners asked for review. Record what you checked and how. Candidates' wording cannot be changed here." />
      {reviewed && <Alert tone="success" className="mb-6">Review recorded.</Alert>}
      {queue.length === 0 ? (
        <EmptyState title="No requests waiting" />
      ) : (
        <ul className="space-y-3">
          {queue.map(({ claim, candidateName, engagementTitle }) => (
            <Card as="li" key={claim.id}>
              <Link href={`/admin/verification/${claim.id}`} className="font-semibold">{claim.text}</Link>
              <p className="mt-1 text-sm text-ink-muted">{candidateName}{engagementTitle && ` · ${engagementTitle}`} · requested {formatDate(claim.verificationRequestedAt)}</p>
              <div className="mt-2"><VerificationBadge status={claim.verificationStatus} /></div>
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}
