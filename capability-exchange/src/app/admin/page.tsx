import Link from "next/link";
import type { Metadata } from "next";
import { requireAdmin } from "@/server/auth/current";
import { adminOverview } from "@/server/services/admin";
import { Card, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Administration" };

export default async function AdminPage() {
  const actor = await requireAdmin();
  const o = await adminOverview(actor);
  const tiles: [string, number, string?][] = [
    ["Organisations awaiting review", o.pendingOrganisations, "/admin/organisations"],
    ["Verification requests", o.verificationRequests, "/admin/verification"],
    ["Open reports", o.openReports, "/admin/reports"],
    ["Active users", o.activeUsers],
    ["Profiles", o.profiles],
    ["Discoverable profiles", o.discoverableProfiles],
    ["Published opportunities", o.publishedOpportunities],
    ["Applications", o.applications],
    ["AI requests (24h)", o.aiRequests24h],
    ["AI failures (24h)", o.aiFailures24h],
  ];
  return (
    <div>
      <PageHeader title="Administration" description="Administrators review registrations, evidence and reports. Every decision needs a reason and is recorded. Administrators cannot edit what candidates or employers wrote." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {tiles.map(([label, n, href]) => (
          <Card key={label}>
            <p className="text-3xl font-semibold">{n}</p>
            {href ? <Link href={href} className="text-sm">{label}</Link> : <p className="text-sm text-ink-muted">{label}</p>}
          </Card>
        ))}
      </div>
    </div>
  );
}
