import Link from "next/link";
import type { Metadata } from "next";
import { requireDiscoveryAccess } from "@/server/auth/current";
import { primaryMembership } from "@/server/policy/actor";
import { searchTalent, visibleSectors } from "@/server/services/search";
import { listOrganisationOpportunities, listRequirements, type OpportunityRow } from "@/server/services/employer";
import { listShortlists } from "@/server/services/applications";
import { compareProfileToOpportunity } from "@/server/services/matching";
import { ActionForm, SelectField, SubmitButton } from "@/components/forms";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui";
import { availabilityStatuses, compensationPeriods, currencies, labelOf, opportunityTypes, workArrangements } from "@/config/taxonomy";
import { addToShortlistAction } from "../actions";

export const metadata: Metadata = { title: "Find talent" };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default async function SearchPage({ searchParams }: PageProps<"/employer/search">) {
  const actor = await requireDiscoveryAccess();
  const sp = await searchParams;
  const m = primaryMembership(actor)!;
  const raw = {
    q: one(sp.q),
    capabilities: one(sp.capabilities).split(",").map((s) => s.trim()).filter(Boolean),
    sector: one(sp.sector),
    country: one(sp.country),
    arrangement: one(sp.arrangement),
    availability: one(sp.availability),
    availableBy: one(sp.availableBy),
    engagementType: one(sp.engagementType),
    evidence: one(sp.evidence),
    budgetCurrency: one(sp.budgetCurrency),
    budgetPeriod: one(sp.budgetPeriod),
    budgetMax: one(sp.budgetMax).replace(/\D/g, ""),
  };
  const [{ results, filters }, sectorList, opps, lists] = await Promise.all([
    searchTalent(actor, raw).catch(() => searchTalent(actor, {})),
    visibleSectors(),
    listOrganisationOpportunities(actor, m.organisationId),
    listShortlists(actor),
  ]);
  const opportunityId = one(sp.opportunity);
  const opp: OpportunityRow | undefined = opps.find((o) => o.id === opportunityId);
  const requirements = opp ? await listRequirements(opp.id) : [];
  const field = "block w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5";
  const label = "mb-1 block text-sm font-semibold";

  return (
    <div>
      <PageHeader title="Find talent" description="Only professionals who chose to be discoverable appear here, showing only what they share. There is no overall score: compare requirements one by one." />
      <div className="grid gap-8 lg:grid-cols-[18rem_1fr]">
        <form role="search" aria-label="Talent search filters" className="space-y-4 self-start rounded-[var(--radius-card)] border border-line bg-surface p-4">
          <div><label htmlFor="q" className={label}>Keywords</label><input id="q" name="q" defaultValue={filters.q} className={field} /></div>
          <div><label htmlFor="capabilities" className={label}>Capabilities</label><input id="capabilities" name="capabilities" defaultValue={filters.capabilities.join(", ")} className={field} aria-describedby="cap-hint" /><p id="cap-hint" className="mt-1 text-xs text-ink-muted">Comma separated; all must match.</p></div>
          <div><label htmlFor="sector" className={label}>Sector experience</label><select id="sector" name="sector" defaultValue={filters.sector} className={field}><option value="">Any</option>{sectorList.map((s) => <option key={s}>{s}</option>)}</select></div>
          <div><label htmlFor="country" className={label}>Country</label><input id="country" name="country" defaultValue={filters.country} className={field} /></div>
          <div><label htmlFor="arrangement" className={label}>Open to</label><select id="arrangement" name="arrangement" defaultValue={filters.arrangement} className={field}><option value="">Any arrangement</option>{workArrangements.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}</select></div>
          <div><label htmlFor="engagementType" className={label}>Engagement type</label><select id="engagementType" name="engagementType" defaultValue={filters.engagementType} className={field}><option value="">Any</option>{opportunityTypes.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}</select></div>
          <div><label htmlFor="availability" className={label}>Availability</label><select id="availability" name="availability" defaultValue={filters.availability} className={field}><option value="">Any</option>{availabilityStatuses.filter((a) => a.value !== "not_available").map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}</select></div>
          <div><label htmlFor="availableBy" className={label}>Available by</label><input id="availableBy" name="availableBy" type="date" defaultValue={filters.availableBy} className={field} /></div>
          <div><label htmlFor="evidence" className={label}>Evidence</label><select id="evidence" name="evidence" defaultValue={filters.evidence} className={field}><option value="">Any</option><option value="evidence_supplied">Has claims with evidence</option><option value="independently_verified">Has independently verified claims</option></select></div>
          <fieldset className="space-y-2">
            <legend className={label}>Budget (optional)</legend>
            <div className="grid grid-cols-2 gap-2">
              <select name="budgetCurrency" aria-label="Budget currency" defaultValue={filters.budgetCurrency} className={field}><option value="">Currency</option>{currencies.map((c) => <option key={c}>{c}</option>)}</select>
              <select name="budgetPeriod" aria-label="Budget period" defaultValue={filters.budgetPeriod} className={field}><option value="">Period</option>{compensationPeriods.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
            </div>
            <input name="budgetMax" aria-label="Maximum budget" inputMode="numeric" defaultValue={filters.budgetMax} placeholder="Maximum" className={field} />
            <p className="text-xs text-ink-muted">Only compares expectations candidates chose to share, in the same currency and period.</p>
          </fieldset>
          <div><label htmlFor="opportunity" className={label}>Compare with</label><select id="opportunity" name="opportunity" defaultValue={opportunityId} className={field}><option value="">No opportunity</option>{opps.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}</select></div>
          <Button type="submit" className="w-full">Search</Button>
          <Link href="/employer/search" className="block text-center text-sm">Clear filters</Link>
        </form>
        <div>
          <p className="mb-4 text-sm text-ink-muted" aria-live="polite">{results.length} profile{results.length === 1 ? "" : "s"}{filters.q ? " · ordered by keyword relevance" : " · most recently updated first"}</p>
          {results.length === 0 ? (
            <EmptyState title="No discoverable profiles match">Try removing a filter. Profiles that are private never appear.</EmptyState>
          ) : (
            <ul className="space-y-4">
              {results.map((r) => {
                const v = r.view;
                const cmp = opp ? compareProfileToOpportunity(v, opp, requirements) : null;
                return (
                  <Card as="li" key={v.id}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h2 className="text-xl"><Link href={`/employer/talent/${v.id}${opp ? `?opportunity=${opp.id}` : ""}`}>{v.preferredName || v.fullName}</Link></h2>
                        <p className="text-ink-muted">{v.headline}</p>
                        <p className="text-sm text-ink-soft">{[v.locationCity, v.locationCountry].filter(Boolean).join(", ")}{v.availability.status && ` · ${labelOf(availabilityStatuses, v.availability.status)}`}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {r.verifiedClaims > 0 && <Badge tone="success">✓ {r.verifiedClaims} verified</Badge>}
                        {r.evidencedClaims > 0 && <Badge tone="info">◐ {r.evidencedClaims} with evidence</Badge>}
                        {r.compensation === "within_budget" && <Badge tone="success">Within budget</Badge>}
                        {r.compensation === "not_shared" && <Badge>Compensation not shared</Badge>}
                        {r.compensation === "not_comparable" && <Badge>Compensation not comparable</Badge>}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {v.capabilities.filter((c) => c.tier === "core").slice(0, 5).map((c) => (
                        <Badge key={c.id} tone={r.matchedCapabilities.includes(c.name) ? "accent" : "neutral"}>{c.name}</Badge>
                      ))}
                    </div>
                    {cmp && (
                      <p className="mt-3 text-sm">
                        <strong>{opp!.title}:</strong> {cmp.summary.essentialSupported} of {cmp.summary.essentialTotal} essential requirements supported by evidence · {cmp.summary.stated + cmp.summary.review} unconfirmed · {cmp.summary.gaps} potential gaps · {cmp.summary.notProvided} not addressed
                      </p>
                    )}
                    {lists.length > 0 && (
                      <details className="mt-3">
                        <summary className="cursor-pointer text-sm font-semibold text-accent-strong">Add to a shortlist</summary>
                        <ActionForm action={addToShortlistAction} className="mt-2 max-w-sm" aria-label={`Add ${v.fullName} to a shortlist`}>
                          <input type="hidden" name="profileId" value={v.id} />
                          <SelectField name="shortlistId" label="Shortlist" required options={lists.map((l) => ({ value: l.id, label: l.name }))} defaultValue={lists[0].id} />
                          <SubmitButton variant="secondary">Add</SubmitButton>
                        </ActionForm>
                      </details>
                    )}
                  </Card>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
