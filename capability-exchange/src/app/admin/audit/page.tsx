import type { Metadata } from "next";
import { requireAdmin } from "@/server/auth/current";
import { listAuditEvents } from "@/server/services/admin";
import { Button, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Audit record" };

export default async function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  const actor = await requireAdmin();
  const { action } = await searchParams;
  const filter = typeof action === "string" ? action : "";
  const events = await listAuditEvents(actor, { action: filter || undefined });
  return (
    <div>
      <PageHeader title="Audit record" description="Append-only record of significant actions. It holds identifiers, decisions and reasons, never profile content." />
      <form className="mb-6 flex flex-wrap items-end gap-3" role="search" aria-label="Filter audit events">
        <div>
          <label htmlFor="action" className="mb-1 block text-sm font-semibold">Action starts with</label>
          <input id="action" name="action" defaultValue={filter} placeholder="e.g. organisation." className="rounded-lg border border-line-strong bg-surface px-3 py-2.5" />
        </div>
        <Button type="submit" variant="secondary">Filter</Button>
      </form>
      <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
        <table className="w-full min-w-[48rem] text-left text-sm">
          <caption className="sr-only">Most recent 300 audit events</caption>
          <thead className="bg-surface-muted">
            <tr>
              <th scope="col" className="p-3">When</th>
              <th scope="col" className="p-3">Who</th>
              <th scope="col" className="p-3">Action</th>
              <th scope="col" className="p-3">Target</th>
              <th scope="col" className="p-3">Reason and details</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="border-t border-line align-top">
                <td className="p-3 whitespace-nowrap">{e.createdAt.toISOString().replace("T", " ").slice(0, 16)}</td>
                <td className="p-3">{e.actorName}{e.actorRole && <span className="block text-xs text-ink-soft">{e.actorRole}</span>}</td>
                <td className="p-3 font-mono text-xs">{e.action}</td>
                <td className="p-3 text-xs">{e.targetType}<span className="block font-mono text-ink-soft">{e.targetId?.slice(0, 8)}</span></td>
                <td className="p-3 text-xs">{e.reason}{Object.keys(e.metadata as object).length > 0 && <span className="block font-mono text-ink-soft">{JSON.stringify(e.metadata)}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
