import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/server/db/client";
import { talentProfiles, users } from "@/server/db/schema";
import { approvedOrgIds, canDiscoverTalent, type Actor } from "@/server/policy/actor";
import { forbidden } from "@/server/errors";
import { buildProfileView, type ProfileView } from "./profile-view";
import { activeGrants } from "@/server/policy/profile-access";
import { slugify } from "./profile";

export const searchFiltersSchema = z.object({
  q: z.string().trim().max(200).optional().default(""),
  capabilities: z.array(z.string().trim().max(80)).max(8).optional().default([]),
  sector: z.string().trim().max(80).optional().default(""),
  country: z.string().trim().max(80).optional().default(""),
  arrangement: z.enum(["", "remote", "hybrid", "on_site"]).optional().default(""),
  availability: z.enum(["", "available_now", "available_from", "open_to_conversations"]).optional().default(""),
  availableBy: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).optional().default(""),
  engagementType: z.enum(["", "permanent", "fixed_term", "project", "fractional", "advisory"]).optional().default(""),
  evidence: z.enum(["", "evidence_supplied", "independently_verified"]).optional().default(""),
  budgetCurrency: z.string().trim().max(3).optional().default(""),
  budgetPeriod: z.enum(["", "annual", "monthly", "daily", "hourly"]).optional().default(""),
  budgetMax: z.string().regex(/^\d*$/).optional().default(""),
});
export type SearchFilters = z.infer<typeof searchFiltersSchema>;

export interface SearchResult {
  view: ProfileView;
  matchedCapabilities: string[];
  evidencedClaims: number;
  verifiedClaims: number;
  compensation: "within_budget" | "above_budget" | "not_comparable" | "not_shared" | "no_budget";
}

/**
 * Structured talent search for members of approved organisations.
 *
 * Visibility is enforced in the query itself: only profiles their owners made visible
 * to approved employers are candidates, and every filter only looks at fields and
 * records visible to approved employers. Keyword search uses a document that contains
 * employer-visible text only. Compensation filters use expectations only when the
 * candidate chose to share them; profiles without shared figures are kept and labelled.
 *
 * Ordering: by keyword relevance (Postgres ts_rank) when keywords are given, otherwise by
 * most recently updated. There is no overall talent score.
 */
export async function searchTalent(actor: Actor, raw: unknown): Promise<{ results: SearchResult[]; filters: SearchFilters }> {
  if (!canDiscoverTalent(actor)) throw forbidden("Talent search opens once an administrator approves your organisation.");
  const filters = searchFiltersSchema.parse(raw);
  const db = getDb();
  const where: SQL[] = [eq(talentProfiles.visibility, "approved_employers"), eq(users.status, "active")];

  // People never see their own profile in their own search results.
  where.push(sql`${talentProfiles.userId} <> ${actor.userId}`);

  let rank: SQL | null = null;
  if (filters.q) {
    const tsq = sql`websearch_to_tsquery('english', ${filters.q})`;
    where.push(sql`to_tsvector('english', ${talentProfiles.searchText}) @@ ${tsq}`);
    rank = sql`ts_rank(to_tsvector('english', ${talentProfiles.searchText}), ${tsq})`;
  }
  for (const cap of filters.capabilities.filter(Boolean)) {
    const slug = slugify(cap);
    const like = `%${cap}%`;
    where.push(sql`exists (
      select 1 from profile_capabilities pc join capabilities c on c.id = pc.capability_id
      where pc.profile_id = ${talentProfiles.id} and pc.visibility = 'approved_employers'
        and (c.slug = ${slug} or c.name ilike ${like}))`);
  }
  if (filters.sector) {
    where.push(sql`(${filters.sector} = any(${talentProfiles.sectors}) or exists (
      select 1 from engagements e where e.profile_id = ${talentProfiles.id} and e.visibility = 'approved_employers' and e.sector = ${filters.sector}))`);
  }
  if (filters.country) where.push(sql`${talentProfiles.locationCountry} ilike ${filters.country}`);
  if (filters.arrangement) where.push(sql`${filters.arrangement}::work_arrangement = any(${talentProfiles.workArrangements})`);
  if (filters.engagementType) where.push(sql`${filters.engagementType}::opportunity_type = any(${talentProfiles.opportunityTypes})`);
  if (filters.availability) where.push(sql`${talentProfiles.availabilityStatus} = ${filters.availability}`);
  if (filters.availableBy) {
    where.push(sql`(${talentProfiles.availabilityStatus} in ('available_now', 'open_to_conversations')
      or (${talentProfiles.availabilityStatus} = 'available_from' and ${talentProfiles.availableFrom} <= ${filters.availableBy}))`);
  }
  if (filters.evidence) {
    const statuses = filters.evidence === "independently_verified" ? ["independently_verified"] : ["evidence_supplied", "independently_verified"];
    where.push(sql`exists (
      select 1 from claims cl left join engagements e on e.id = cl.engagement_id
      where cl.profile_id = ${talentProfiles.id} and cl.visibility = 'approved_employers'
        and (cl.engagement_id is null or e.visibility = 'approved_employers')
        and cl.verification_status in (${sql.join(statuses.map((s) => sql`${s}`), sql`, `)}))`);
  }
  const budgetMax = filters.budgetMax ? Number(filters.budgetMax) : null;
  if (budgetMax && filters.budgetCurrency && filters.budgetPeriod) {
    // Exclude only candidates whose *shared* minimum is above budget in the same currency and period.
    where.push(sql`not (
      ${talentProfiles.compensationVisibility} = 'approved_employers'
      and ${talentProfiles.compensationCurrency} = ${filters.budgetCurrency}
      and ${talentProfiles.compensationPeriod} = ${filters.budgetPeriod}
      and coalesce(${talentProfiles.compensationMin}, ${talentProfiles.compensationMax}) > ${budgetMax})`);
  }

  const rows = await db
    .select({ profile: talentProfiles })
    .from(talentProfiles)
    .innerJoin(users, eq(users.id, talentProfiles.userId))
    .where(and(...where))
    .orderBy(...(rank ? [desc(rank), desc(talentProfiles.updatedAt)] : [desc(talentProfiles.updatedAt)]))
    .limit(50);

  const orgId = approvedOrgIds(actor)[0];
  const results: SearchResult[] = [];
  for (const { profile } of rows) {
    const view = await buildProfileView(profile, { kind: "employer", organisationId: orgId, grants: await activeGrants(profile.id, orgId) });
    const allClaims = [...view.standaloneClaims, ...view.engagements.flatMap((e) => e.claims)];
    const wanted = filters.capabilities.map((c) => c.toLowerCase());
    let compensation: SearchResult["compensation"] = "no_budget";
    if (budgetMax && filters.budgetCurrency && filters.budgetPeriod) {
      const c = view.compensation;
      if (!c || (!c.min && !c.max)) compensation = "not_shared";
      else if (c.currency !== filters.budgetCurrency || c.period !== filters.budgetPeriod) compensation = "not_comparable";
      else compensation = Number(c.min ?? c.max) <= budgetMax ? "within_budget" : "above_budget";
    }
    results.push({
      view,
      matchedCapabilities: view.capabilities.filter((c) => wanted.some((w) => c.name.toLowerCase().includes(w))).map((c) => c.name),
      evidencedClaims: allClaims.filter((c) => c.verificationStatus === "evidence_supplied").length,
      verifiedClaims: allClaims.filter((c) => c.verificationStatus === "independently_verified").length,
      compensation,
    });
  }
  return { results, filters };
}

/** Distinct sectors used by visible profiles, for the filter list. */
export async function visibleSectors() {
  const rows = await getDb()
    .selectDistinct({ sector: sql<string>`unnest(${talentProfiles.sectors})` })
    .from(talentProfiles)
    .where(eq(talentProfiles.visibility, "approved_employers"));
  return rows.map((r) => r.sector).sort();
}

