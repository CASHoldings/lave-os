import { and, count, desc, eq, gt, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/server/db/client";
import {
  aiRequests,
  applications,
  auditEvents,
  claimEvidence,
  claims,
  contentReports,
  engagements,
  evidenceItems,
  opportunities,
  organisations,
  talentProfiles,
  users,
  verificationReviews,
} from "@/server/db/schema";
import { fieldErrorsFrom, reasonSchema, reportSchema, verificationReviewSchema } from "@/lib/validation";
import { assertAdmin, type Actor } from "@/server/policy/actor";
import { conflict, notFound, validationError } from "@/server/errors";
import { recomputeClaimStatus } from "./portfolio";
import { buildProfileView } from "./profile-view";
import { profileChanged } from "./profile";
import { audit } from "./audit";

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */

export async function adminOverview(actor: Actor) {
  assertAdmin(actor);
  const db = getDb();
  const since = new Date(Date.now() - 86400_000);
  const [[u], [p], [pv], [op], [opub], [apps], [rq], [reports], [ai], [aiFail]] = await Promise.all([
    db.select({ n: count() }).from(users).where(eq(users.status, "active")),
    db.select({ n: count() }).from(talentProfiles),
    db.select({ n: count() }).from(talentProfiles).where(eq(talentProfiles.visibility, "approved_employers")),
    db.select({ n: count() }).from(organisations).where(eq(organisations.status, "pending")),
    db.select({ n: count() }).from(opportunities).where(eq(opportunities.status, "published")),
    db.select({ n: count() }).from(applications),
    db.select({ n: count() }).from(claims).where(and(isNotNull(claims.verificationRequestedAt), ne(claims.verificationStatus, "independently_verified"))),
    db.select({ n: count() }).from(contentReports).where(eq(contentReports.status, "open")),
    db.select({ n: count() }).from(aiRequests).where(gt(aiRequests.createdAt, since)),
    db.select({ n: count() }).from(aiRequests).where(and(gt(aiRequests.createdAt, since), eq(aiRequests.succeeded, false))),
  ]);
  return {
    activeUsers: u.n,
    profiles: p.n,
    discoverableProfiles: pv.n,
    pendingOrganisations: op.n,
    publishedOpportunities: opub.n,
    applications: apps.n,
    verificationRequests: rq.n,
    openReports: reports.n,
    aiRequests24h: ai.n,
    aiFailures24h: aiFail.n,
  };
}

/* ------------------------------------------------------------------ */
/* Employer registrations                                              */
/* ------------------------------------------------------------------ */

export async function listOrganisationsForReview(actor: Actor) {
  assertAdmin(actor);
  return getDb()
    .select({ org: organisations, creatorName: users.displayName, creatorEmail: users.email })
    .from(organisations)
    .leftJoin(users, eq(users.id, organisations.createdBy))
    .orderBy(sql`case when ${organisations.status} = 'pending' then 0 else 1 end`, desc(organisations.createdAt));
}

export async function reviewOrganisation(actor: Actor, organisationId: string, decision: "approved" | "rejected" | "suspended", reason: unknown) {
  assertAdmin(actor);
  const parsedReason = reasonSchema.safeParse(reason);
  if (!parsedReason.success) throw validationError({ reason: parsedReason.error.issues[0].message });
  const db = getDb();
  const [org] = await db.select().from(organisations).where(eq(organisations.id, organisationId));
  if (!org) throw notFound();
  await db
    .update(organisations)
    .set({ status: decision, reviewedBy: actor.userId, reviewedAt: new Date(), reviewReason: parsedReason.data, updatedAt: new Date() })
    .where(eq(organisations.id, organisationId));
  await audit({
    actorUserId: actor.userId,
    actorRole: "admin",
    action: `organisation.${decision}`,
    targetType: "organisation",
    targetId: organisationId,
    organisationId,
    reason: parsedReason.data,
    metadata: { from: org.status, to: decision },
  });
}

/* ------------------------------------------------------------------ */
/* Verification                                                        */
/* ------------------------------------------------------------------ */

export async function verificationQueue(actor: Actor) {
  assertAdmin(actor);
  return getDb()
    .select({ claim: claims, candidateName: talentProfiles.fullName, engagementTitle: engagements.title })
    .from(claims)
    .innerJoin(talentProfiles, eq(talentProfiles.id, claims.profileId))
    .leftJoin(engagements, eq(engagements.id, claims.engagementId))
    .where(and(isNotNull(claims.verificationRequestedAt), ne(claims.verificationStatus, "independently_verified")))
    .orderBy(claims.verificationRequestedAt);
}

export async function getClaimForReview(actor: Actor, claimId: string) {
  assertAdmin(actor);
  const db = getDb();
  const [row] = await db
    .select({ claim: claims, candidateName: talentProfiles.fullName, profileId: talentProfiles.id, engagement: engagements })
    .from(claims)
    .innerJoin(talentProfiles, eq(talentProfiles.id, claims.profileId))
    .leftJoin(engagements, eq(engagements.id, claims.engagementId))
    .where(eq(claims.id, claimId))
    .limit(1);
  if (!row) throw notFound("That claim");
  const evidence = await db
    .select({ id: evidenceItems.id, kind: evidenceItems.kind, title: evidenceItems.title, description: evidenceItems.description, url: evidenceItems.url, fileName: evidenceItems.fileName, isRedacted: evidenceItems.isRedacted, redactionNote: evidenceItems.redactionNote })
    .from(claimEvidence)
    .innerJoin(evidenceItems, eq(evidenceItems.id, claimEvidence.evidenceId))
    .where(eq(claimEvidence.claimId, claimId));
  const reviews = await db
    .select({ review: verificationReviews, reviewerName: users.displayName })
    .from(verificationReviews)
    .leftJoin(users, eq(users.id, verificationReviews.reviewerUserId))
    .where(eq(verificationReviews.claimId, claimId))
    .orderBy(desc(verificationReviews.reviewedAt));
  await audit({ actorUserId: actor.userId, actorRole: "admin", action: "admin.claim_opened_for_review", targetType: "claim", targetId: claimId });
  return { ...row, evidence, reviews };
}

/**
 * Records a reviewer's decision. The candidate's claim text is never changed. The review
 * must state what was checked and how; only this function can make a claim
 * "independently verified", and only with evidence attached and a human reviewer.
 */
export async function recordVerificationReview(actor: Actor, input: unknown) {
  assertAdmin(actor);
  const parsed = verificationReviewSchema.safeParse(input);
  if (!parsed.success) throw validationError(fieldErrorsFrom(parsed.error));
  const data = parsed.data;
  const db = getDb();
  const [claim] = await db.select().from(claims).where(eq(claims.id, data.claimId));
  if (!claim) throw notFound("That claim");
  const attached = await db.select({ id: claimEvidence.evidenceId }).from(claimEvidence).where(eq(claimEvidence.claimId, data.claimId));
  const attachedIds = new Set(attached.map((a) => a.id));
  const reviewed = data.evidenceIdsReviewed.filter((id) => attachedIds.has(id));
  if (data.decision === "independently_verified" && reviewed.length === 0 && data.method !== "reference_check" && data.method !== "public_record") {
    throw validationError({ evidenceIdsReviewed: "Select the evidence you reviewed. A claim cannot be verified without stating what was checked." });
  }

  await db.transaction(async (tx) => {
    await tx.insert(verificationReviews).values({
      claimId: data.claimId,
      reviewerUserId: actor.userId,
      decision: data.decision,
      method: data.method,
      scope: data.scope,
      evidenceIdsReviewed: reviewed,
      noteToCandidate: data.noteToCandidate,
      reason: data.reason,
      claimTextAtReview: claim.text,
    });
    if (data.decision === "independently_verified") {
      await tx.update(claims).set({ verificationStatus: "independently_verified", verificationRequestedAt: null }).where(eq(claims.id, data.claimId));
    } else if (data.decision === "clarification_requested") {
      await tx.update(claims).set({ verificationStatus: "clarification_requested", verificationRequestedAt: null }).where(eq(claims.id, data.claimId));
    } else {
      // Not verified: the claim returns to its evidence-based status; the review stays on record.
      await tx.update(claims).set({ verificationStatus: "self_reported", verificationRequestedAt: null }).where(eq(claims.id, data.claimId));
    }
  });
  if (data.decision === "not_verified") await recomputeClaimStatus(data.claimId);
  await profileChanged(claim.profileId);
  await audit({
    actorUserId: actor.userId,
    actorRole: "admin",
    action: "verification.reviewed",
    targetType: "claim",
    targetId: data.claimId,
    reason: data.reason,
    metadata: { decision: data.decision, method: data.method, count: reviewed.length },
  });
}

/* ------------------------------------------------------------------ */
/* Reports                                                             */
/* ------------------------------------------------------------------ */

export async function createReport(actor: Actor, input: unknown) {
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) throw validationError(fieldErrorsFrom(parsed.error));
  const [row] = await getDb()
    .insert(contentReports)
    .values({ ...parsed.data, reporterUserId: actor.userId })
    .returning({ id: contentReports.id });
  await audit({ actorUserId: actor.userId, action: "report.created", targetType: parsed.data.targetType, targetId: parsed.data.targetId, metadata: { reportId: row.id, kind: parsed.data.category } });
  return row.id;
}

export async function listReports(actor: Actor) {
  assertAdmin(actor);
  return getDb().select().from(contentReports).orderBy(sql`case when ${contentReports.status} = 'open' then 0 else 1 end`, desc(contentReports.createdAt)).limit(200);
}

export const reportActionSchema = z.enum(["none", "close_opportunity", "suspend_organisation", "suspend_user", "hide_profile"]);

/**
 * Resolves a report. Available actions restrict access (close, suspend, hide from
 * discovery); none of them edit what a candidate or employer wrote.
 */
export async function resolveReport(actor: Actor, reportId: string, outcome: "actioned" | "dismissed", action: string, reason: unknown) {
  assertAdmin(actor);
  const parsedReason = reasonSchema.safeParse(reason);
  if (!parsedReason.success) throw validationError({ reason: parsedReason.error.issues[0].message });
  const act = reportActionSchema.parse(action);
  const db = getDb();
  const [report] = await db.select().from(contentReports).where(eq(contentReports.id, reportId));
  if (!report) throw notFound();
  if (report.status !== "open") throw conflict("This report has already been resolved.");

  if (outcome === "actioned" && act !== "none") {
    if (act === "close_opportunity" && report.targetType === "opportunity") {
      await db.update(opportunities).set({ status: "closed", closedAt: new Date() }).where(eq(opportunities.id, report.targetId));
    } else if (act === "suspend_organisation" && (report.targetType === "organisation" || report.targetType === "opportunity")) {
      const orgId =
        report.targetType === "organisation"
          ? report.targetId
          : (await db.select({ org: opportunities.organisationId }).from(opportunities).where(eq(opportunities.id, report.targetId)))[0]?.org;
      if (orgId) await db.update(organisations).set({ status: "suspended", reviewedBy: actor.userId, reviewedAt: new Date(), reviewReason: parsedReason.data }).where(eq(organisations.id, orgId));
    } else if ((act === "suspend_user" || act === "hide_profile") && report.targetType === "profile") {
      const [profile] = await db.select().from(talentProfiles).where(eq(talentProfiles.id, report.targetId));
      if (profile && act === "suspend_user") await db.update(users).set({ status: "suspended" }).where(eq(users.id, profile.userId));
      if (profile && act === "hide_profile") {
        await db.update(talentProfiles).set({ visibility: "private" }).where(eq(talentProfiles.id, profile.id));
        await profileChanged(profile.id);
      }
    } else {
      throw validationError({ action: "That action does not apply to this kind of report." });
    }
  }
  await db
    .update(contentReports)
    .set({ status: outcome, resolutionNote: parsedReason.data, resolvedBy: actor.userId, resolvedAt: new Date() })
    .where(eq(contentReports.id, reportId));
  await audit({
    actorUserId: actor.userId,
    actorRole: "admin",
    action: "report.resolved",
    targetType: report.targetType,
    targetId: report.targetId,
    reason: parsedReason.data,
    metadata: { reportId, result: outcome, kind: act },
  });
}

/* ------------------------------------------------------------------ */
/* Audit                                                               */
/* ------------------------------------------------------------------ */

export async function listAuditEvents(actor: Actor, filter: { action?: string } = {}) {
  assertAdmin(actor);
  const where = filter.action ? sql`${auditEvents.action} like ${filter.action.replace(/[%_]/g, "") + "%"}` : undefined;
  const rows = await getDb().select().from(auditEvents).where(where).orderBy(desc(auditEvents.createdAt)).limit(300);
  const actorIds = Array.from(new Set(rows.map((r) => r.actorUserId).filter(Boolean))) as string[];
  const names = actorIds.length ? await getDb().select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, actorIds)) : [];
  return rows.map((r) => ({ ...r, actorName: names.find((n) => n.id === r.actorUserId)?.name ?? (r.actorUserId ? "Deleted account" : "System") }));
}

/** Administrator view of a profile for moderation. Every view is recorded. */
export async function getProfileForAdmin(actor: Actor, profileId: string) {
  assertAdmin(actor);
  const [profile] = await getDb().select().from(talentProfiles).where(eq(talentProfiles.id, profileId)).limit(1);
  if (!profile) throw notFound("That profile");
  await audit({ actorUserId: actor.userId, actorRole: "admin", action: "admin.profile_viewed", targetType: "profile", targetId: profileId });
  return buildProfileView(profile, { kind: "admin" });
}
