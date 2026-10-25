import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import {
  applications,
  capabilities,
  opportunities,
  opportunityRequirements,
  organisationMemberships,
  organisations,
  users,
} from "@/server/db/schema";
import { fieldErrorsFrom, opportunitySchema, organisationSchema, requirementSchema } from "@/lib/validation";
import { assertOrgManager, assertOrgMember, primaryMembership, type Actor } from "@/server/policy/actor";
import { conflict, forbidden, notFound, validationError } from "@/server/errors";
import { findOrCreateCapability } from "./profile";
import { audit } from "./audit";

/* ------------------------------------------------------------------ */
/* Organisations                                                       */
/* ------------------------------------------------------------------ */

/** New organisations start as pending. Talent discovery and publishing wait for administrator approval. */
export async function registerOrganisation(actor: Actor, input: unknown) {
  if (actor.memberships.length) throw conflict("You already belong to an organisation.");
  const parsed = organisationSchema.safeParse(input);
  if (!parsed.success) throw validationError(fieldErrorsFrom(parsed.error));
  const db = getDb();
  const orgId = await db.transaction(async (tx) => {
    const [org] = await tx.insert(organisations).values({ ...parsed.data, status: "pending", createdBy: actor.userId }).returning({ id: organisations.id });
    await tx.insert(organisationMemberships).values({ organisationId: org.id, userId: actor.userId, role: "owner" });
    return org.id;
  });
  await audit({ actorUserId: actor.userId, action: "organisation.registered", targetType: "organisation", targetId: orgId, organisationId: orgId });
  return orgId;
}

export async function getOrganisation(actor: Actor, organisationId: string) {
  assertOrgMember(actor, organisationId);
  const [org] = await getDb().select().from(organisations).where(eq(organisations.id, organisationId));
  if (!org) throw notFound();
  return org;
}

export async function updateOrganisation(actor: Actor, organisationId: string, input: unknown) {
  assertOrgManager(actor, organisationId);
  const parsed = organisationSchema.safeParse(input);
  if (!parsed.success) throw validationError(fieldErrorsFrom(parsed.error));
  await getDb().update(organisations).set({ ...parsed.data, updatedAt: new Date() }).where(eq(organisations.id, organisationId));
}

export async function listMembers(actor: Actor, organisationId: string) {
  assertOrgMember(actor, organisationId);
  return getDb()
    .select({ id: organisationMemberships.id, role: organisationMemberships.role, userId: users.id, displayName: users.displayName, email: users.email })
    .from(organisationMemberships)
    .innerJoin(users, eq(users.id, organisationMemberships.userId))
    .where(eq(organisationMemberships.organisationId, organisationId))
    .orderBy(asc(users.displayName));
}

/**
 * Adds an existing employer account to the organisation. No invitation email is sent:
 * email delivery is not configured in this build.
 */
export async function addMember(actor: Actor, organisationId: string, email: string, role: "admin" | "member") {
  assertOrgManager(actor, organisationId);
  const db = getDb();
  const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email.trim().toLowerCase()}`).limit(1);
  if (!user || user.accountType !== "employer" || user.status !== "active") {
    throw validationError({ email: "No employer account uses that email. Ask your colleague to create an employer account first." });
  }
  const [already] = await db.select({ id: organisationMemberships.id }).from(organisationMemberships).where(eq(organisationMemberships.userId, user.id)).limit(1);
  if (already) throw validationError({ email: "That person already belongs to an organisation." });
  await db.insert(organisationMemberships).values({ organisationId, userId: user.id, role });
  await audit({ actorUserId: actor.userId, action: "organisation.member_added", targetType: "user", targetId: user.id, organisationId, metadata: { role } });
}

export async function removeMember(actor: Actor, organisationId: string, membershipId: string) {
  assertOrgManager(actor, organisationId);
  const db = getDb();
  const [m] = await db
    .select()
    .from(organisationMemberships)
    .where(and(eq(organisationMemberships.id, membershipId), eq(organisationMemberships.organisationId, organisationId)));
  if (!m) throw notFound();
  if (m.role === "owner") throw forbidden("Owners cannot be removed here.");
  await db.delete(organisationMemberships).where(eq(organisationMemberships.id, membershipId));
  await audit({ actorUserId: actor.userId, action: "organisation.member_removed", targetType: "user", targetId: m.userId, organisationId });
}

/* ------------------------------------------------------------------ */
/* Opportunities                                                       */
/* ------------------------------------------------------------------ */

export type OpportunityRow = typeof opportunities.$inferSelect;
export type RequirementRow = typeof opportunityRequirements.$inferSelect;

/** Loads an opportunity the actor's organisation owns. Other organisations' opportunities are "not found". */
export async function getOwnOpportunity(actor: Actor, opportunityId: string) {
  const [opp] = await getDb().select().from(opportunities).where(eq(opportunities.id, opportunityId)).limit(1);
  if (!opp || !actor.memberships.some((m) => m.organisationId === opp.organisationId)) throw notFound("That opportunity");
  return opp;
}

export async function listOrganisationOpportunities(actor: Actor, organisationId: string) {
  assertOrgMember(actor, organisationId);
  const db = getDb();
  const opps = await db.select().from(opportunities).where(eq(opportunities.organisationId, organisationId)).orderBy(desc(opportunities.updatedAt));
  const counts = opps.length
    ? await db
        .select({ opportunityId: applications.opportunityId, n: count() })
        .from(applications)
        .where(inArray(applications.opportunityId, opps.map((o) => o.id)))
        .groupBy(applications.opportunityId)
    : [];
  return opps.map((o) => ({ ...o, applicationCount: counts.find((c) => c.opportunityId === o.id)?.n ?? 0 }));
}

export async function saveOpportunity(actor: Actor, input: unknown, opportunityId?: string | null) {
  const membership = primaryMembership(actor);
  if (!membership) throw forbidden("Create your organisation first.");
  const parsed = opportunitySchema.safeParse(input);
  if (!parsed.success) throw validationError(fieldErrorsFrom(parsed.error));
  const db = getDb();
  if (opportunityId) {
    const opp = await getOwnOpportunity(actor, opportunityId);
    await db.update(opportunities).set({ ...parsed.data, updatedAt: new Date() }).where(eq(opportunities.id, opp.id));
    return opp.id;
  }
  const [row] = await db
    .insert(opportunities)
    .values({ ...parsed.data, organisationId: membership.organisationId, ownerUserId: actor.userId, status: "draft" })
    .returning({ id: opportunities.id });
  await audit({ actorUserId: actor.userId, action: "opportunity.created", targetType: "opportunity", targetId: row.id, organisationId: membership.organisationId });
  return row.id;
}

export async function setOpportunityStatus(actor: Actor, opportunityId: string, status: "draft" | "published" | "closed") {
  const opp = await getOwnOpportunity(actor, opportunityId);
  if (status === "published") {
    assertOrgMember(actor, opp.organisationId, { requireApproved: true });
    const missing: Record<string, string> = {};
    if (!opp.problemStatement) missing.problemStatement = "Describe the problem to solve before publishing.";
    if (!opp.expectedOutcomes) missing.expectedOutcomes = "Describe the expected outcomes before publishing.";
    const [{ n }] = await getDb().select({ n: count() }).from(opportunityRequirements).where(eq(opportunityRequirements.opportunityId, opp.id));
    if (n === 0) missing.requirements = "Add at least one requirement before publishing.";
    if (Object.keys(missing).length) throw validationError(missing, "A few things are needed before this can be published.");
  }
  await getDb()
    .update(opportunities)
    .set({
      status,
      updatedAt: new Date(),
      ...(status === "published" ? { publishedAt: opp.publishedAt ?? new Date(), closedAt: null } : {}),
      ...(status === "closed" ? { closedAt: new Date() } : {}),
    })
    .where(eq(opportunities.id, opp.id));
  await audit({ actorUserId: actor.userId, action: `opportunity.${status}`, targetType: "opportunity", targetId: opp.id, organisationId: opp.organisationId, metadata: { from: opp.status, to: status } });
}

export async function listRequirements(opportunityId: string) {
  return getDb()
    .select()
    .from(opportunityRequirements)
    .where(eq(opportunityRequirements.opportunityId, opportunityId))
    .orderBy(asc(opportunityRequirements.importance), asc(opportunityRequirements.sortOrder), asc(opportunityRequirements.label));
}

export async function addRequirement(actor: Actor, opportunityId: string, input: unknown) {
  const opp = await getOwnOpportunity(actor, opportunityId);
  const parsed = requirementSchema.safeParse(input);
  if (!parsed.success) throw validationError(fieldErrorsFrom(parsed.error));
  let capabilityId: string | null = null;
  if (parsed.data.kind === "capability" || parsed.data.kind === "language") {
    const cap = await findOrCreateCapability(parsed.data.label, parsed.data.kind === "language" ? "language" : "functional");
    capabilityId = cap.id;
  }
  await getDb().insert(opportunityRequirements).values({ ...parsed.data, capabilityId, opportunityId: opp.id });
  await getDb().update(opportunities).set({ updatedAt: new Date() }).where(eq(opportunities.id, opp.id));
}

export async function removeRequirement(actor: Actor, opportunityId: string, requirementId: string) {
  const opp = await getOwnOpportunity(actor, opportunityId);
  const res = await getDb()
    .delete(opportunityRequirements)
    .where(and(eq(opportunityRequirements.id, requirementId), eq(opportunityRequirements.opportunityId, opp.id)))
    .returning({ id: opportunityRequirements.id });
  if (!res.length) throw notFound();
}

/* ------------------------------------------------------------------ */
/* Published opportunities (talent-facing)                             */
/* ------------------------------------------------------------------ */

export interface OpportunityFilters {
  q?: string;
  type?: string;
  arrangement?: string;
}

/** Only published opportunities of approved organisations are ever listed to talent. */
export async function listPublishedOpportunities(filters: OpportunityFilters = {}) {
  const conditions = [eq(opportunities.status, "published"), eq(organisations.status, "approved")];
  if (filters.type) conditions.push(sql`${opportunities.engagementType} = ${filters.type}`);
  if (filters.arrangement) conditions.push(sql`${opportunities.workArrangement} = ${filters.arrangement}`);
  if (filters.q) {
    const like = `%${filters.q.slice(0, 100)}%`;
    conditions.push(sql`(${opportunities.title} ilike ${like} or ${opportunities.problemStatement} ilike ${like} or ${organisations.name} ilike ${like} or ${opportunities.locationText} ilike ${like})`);
  }
  return getDb()
    .select({ opportunity: opportunities, organisationName: organisations.name })
    .from(opportunities)
    .innerJoin(organisations, eq(organisations.id, opportunities.organisationId))
    .where(and(...conditions))
    .orderBy(desc(opportunities.publishedAt))
    .limit(100);
}

export async function getPublishedOpportunity(opportunityId: string) {
  const [row] = await getDb()
    .select({ opportunity: opportunities, organisation: organisations })
    .from(opportunities)
    .innerJoin(organisations, eq(organisations.id, opportunities.organisationId))
    .where(and(eq(opportunities.id, opportunityId), eq(opportunities.status, "published"), eq(organisations.status, "approved")))
    .limit(1);
  if (!row) throw notFound("That opportunity");
  return { ...row, requirements: await listRequirements(opportunityId) };
}

export async function capabilityNames(ids: string[]) {
  if (!ids.length) return [];
  return getDb().select({ id: capabilities.id, name: capabilities.name }).from(capabilities).where(inArray(capabilities.id, ids));
}
