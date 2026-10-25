import Link from "next/link";
import type { Metadata } from "next";
import { requireActor } from "@/server/auth/current";
import { listPublishedOpportunities } from "@/server/services/employer";
import { Badge, Button, Card, EmptyState, PageHeader, formatDate } from "@/components/ui";
import { labelOf, opportunityTypes, workArrangements } from "@/config/taxonomy";
import { brand } from "@/config/brand";

export const metadata: Metadata = { title: "Opportunities" };

export default async function OpportunitiesPage({ searchParams }: PageProps<"/opportunities">) {
  await requireActor("/opportunities");
  const sp = await searchParams;
  const filters = { q: typeof sp.q === "string" ? sp.q : "", type: typeof sp.type === "string" ? sp.type : "", arrangement: typeof sp.arrangement === "string" ? sp.arrangement : "" };
  const rows = await listPublishedOpportunities({
    q: filters.q || undefined,
    type: opportunityTypes.some((t) => t.value === filters.type) ? filters.type : undefined,
    arrangement: workArrangements.some((t) => t.value === filters.arrangement) ? filters.arrangement : undefined,
  });
  const select = "block w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5";
  return (
    <div>
      <PageHeader eyebrow={brand.modules.opportunities.name} title="Opportunities" description={brand.modules.opportunities.description} />
      <form role="search" aria-label="Filter opportunities" className="mb-8 grid gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
        <div>
          <label htmlFor="q" className="mb-1 block text-sm font-semibold">Keywords</label>
          <input id="q" name="q" defaultValue={filters.q} className={select} placeholder="Title, organisation, location" />
        </div>
        <div>
          <label htmlFor="type" className="mb-1 block text-sm font-semibold">Engagement</label>
          <select id="type" name="type" defaultValue={filters.type} className={select}>
            <option value="">Any</option>
            {opportunityTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="arrangement" className="mb-1 block text-sm font-semibold">Arrangement</label>
          <select id="arrangement" name="arrangement" defaultValue={filters.arrangement} className={select}>
            <option value="">Any</option>
            {workArrangements.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <Button type="submit" variant="secondary">Filter</Button>
      </form>
      <p className="mb-4 text-sm text-ink-muted" aria-live="polite">{rows.length} open opportunit{rows.length === 1 ? "y" : "ies"}</p>
      {rows.length === 0 ? (
        <EmptyState title="No opportunities match">Try fewer filters, or check back later.</EmptyState>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {rows.map(({ opportunity: o, organisationName }) => (
            <Card as="li" key={o.id}>
              <div className="flex flex-wrap gap-2">
                <Badge tone="accent">{labelOf(opportunityTypes, o.engagementType)}</Badge>
                {o.workArrangement && <Badge>{labelOf(workArrangements, o.workArrangement)}</Badge>}
              </div>
              <h2 className="mt-3 text-xl">
                <Link href={`/opportunities/${o.id}`}>{o.title}</Link>
              </h2>
              <p className="text-sm text-ink-muted">{organisationName}{o.locationText && ` · ${o.locationText}`}</p>
              {o.problemStatement && <p className="mt-2 line-clamp-3 text-sm">{o.problemStatement}</p>}
              <p className="mt-2 text-xs text-ink-soft">Published {formatDate(o.publishedAt)}</p>
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}
