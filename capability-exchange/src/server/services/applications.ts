import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb, withOrgRls } from "@/server/db/client";
import {
  applicationEvents,
  applicationNotes,
  applications,
  introductionRequests,
  opportunities,
  organisations,
  profileSnapshots,
  shortlistEntries,
  shortlists,
  talentProfiles,
  users,
} from "@/server/db/schema";
import { applicationSchema, fieldErrorsFrom, introductionSchema, shortlistSchema } from "@/lib/validation";
import { approvedOrgIds, assertOrgMember, assertTalent, canDiscoverTalent, type Actor } from "@/server/policy/actor";
import { resolveAudience } from "@/server/policy/profile-access";
import { conflict, forbidden, notFound, validationError } from "@/server/errors";
import { snapshotView } from "./sharing";
import { buildProfileView, type ProfileView } from "./profile-view";
import { listRequirements } from "./employer";
import { compareProfileToOpportunity } from "./matching";
import { audit } from "./audit";
import type { ApplicationStatus } from "@/config/taxonomy";

/* ------------------------------------------------------------------ */
/* Candidate side                                                      */
/* ------------------------------------------------------------------ */

export async function applyToOpportunity(actor: Actor, input: unknown) {
  const profileId = assertTalent(actor);
  const parsed = applicationSchema.safeParse(input);
  if (!parsed.success) throw validationError(fieldErrorsFrom(parsed.error));
  const { opportunityId, expressionOfInterest, includeContact, includeEvidence } = parsed.data;
  const db = getDb();

  const [opp] = await db
    .select({ opp: opportunities, orgStatus: organisations.status })
    .from(opportunities)
    .innerJoin(organisations, eq(organisations.id, opportunities.organisationId))
    .where(eq(opportunities.id, opportunityId))
    .limit(1);
  if (!opp || opp.opp.status !== "published" || opp.orgStatus !== "approved") throw notFound("That opportunity");

  const [profile] = await db.select().from(talentProfiles).where(eq(talentProfiles.id, profileId));
  if (!profile.coreCompletedAt) throw validationError({ _form: "Complete your core profile before applying, so the employer sees an accurate picture." });

  const [existing] = await db
    .select({ id: applications.id })
    .from(applications)
    .where(and(eq(applications.opportunityId, opportunityId), eq(applications.profileId, profileId)))
    .limit(1);
  if (existing) throw conflict("You have already applied for this opportunity.");

  // Built outside the transaction: profile reads use their own connection.
  const view = await snapshotView(profileId, { includeContact, includeEvidence });
  const applicationId = await db.transaction(async (tx) => {
    const [snapshot] = await tx
      .insert(profileSnapshots)
      .values({ profileId, data: view, includeContact, includeEvidence })
      .returning({ id: profileSnapshots.id });
    const [app] = await tx
      .insert(applications)
      .values({
        opportunityId,
        organisationId: opp.opp.organisationId,
        profileId,
        snapshotId: snapshot.id,
        candidateDisplayName: profile.preferredName || profile.fullName,
        expressionOfInterest,
      })
      .returning({ id: applications.id });
    await tx.insert(applicationEvents).values({ applicationId: app.id, actorUserId: actor.userId, toStatus: "submitted" });
    return app.id;
  });
  await audit({
    actorUserId: actor.userId,
    action: "application.submitted",
    targetType: "application",
    targetId: applicationId,
    organisationId: opp.opp.organisationId,
    metadata: { includeContact, includeEvidence },
  });
  return applicationId;
}

export async function listMyApplications(actor: Actor) {
  const profileId = assertTalent(actor);
  return getDb()
    .select({ application: applications, opportunity: opportunities, organisationName: organisations.name })
    .from(applications)
    .innerJoin(opportunities, eq(opportunities.id, applications.opportunityId))
    .innerJoin(organisations, eq(organisations.id, applications.organisationId))
    .where(eq(applications.profileId, profileId))
    .orderBy(desc(applications.updatedAt));
}

export async function getMyApplication(actor: Actor, applicationId: string) {
  const profileId = assertTalent(actor);
  const db = getDb();
  const [row] = await db
    .select({ application: applications, opportunity: opportunities, organisationName: organisations.name, snapshot: profileSnapshots })
    .from(applications)
    .innerJoin(opportunities, eq(opportunities.id, applications.opportunityId))
    .innerJoin(organisations, eq(organisations.id, applications.organisationId))
    .leftJoin(profileSnapshots, eq(profileSnapshots.id, applications.snapshotId))
    .where(and(eq(applications.id, applicationId), eq(applications.profileId, profileId)))
    .limit(1);
  if (!row) throw notFound("That application");
  // Employer notes are never shown to candidates; status history is.
  const events = await db.select({ toStatus: applicationEvents.toStatus, createdAt: applicationEvents.createdAt }).from(applicationEvents).where(eq(applicationEvents.applicationId, applicationId)).orderBy(asc(applicationEvents.createdAt));
  return { ...row, events };
}

/**
 * Withdrawing ends the employer's access to the shared snapshot and any files in it.
 * The employer keeps a record that an application existed, its status history and their own notes.
 */
export async function withdrawApplication(actor: Actor, applicationId: string) {
  const profileId = assertTalent(actor);
  const db = getDb();
  const [app] = await db.select().from(applications).where(and(eq(applications.id, applicationId), eq(applications.profileId, profileId))).limit(1);
  if (!app) throw notFound("That application");
  if (app.status === "withdrawn") return;
  await db.update(applications).set({ status: "withdrawn", withdrawnAt: new Date(), updatedAt: new Date() }).where(eq(applications.id, applicationId));
  await db.insert(applicationEvents).values({ applicationId, actorUserId: actor.userId, fromStatus: app.status, toStatus: "withdrawn" });
  await audit({ actorUserId: actor.userId, action: "application.withdrawn", targetType: "application", targetId: applicationId, organisationId: app.organisationId });
}

/* ------------------------------------------------------------------ */
/* Employer side                                                       */
/* ------------------------------------------------------------------ */

async function employerApplication(actor: Actor, applicationId: string) {
  const [row] = await getDb().select().from(applications).where(eq(applications.id, applicationId)).limit(1);
  if (!row || !approvedOrgIds(actor).includes(row.organisationId)) throw notFound("That application");
  return row;
}

export async function listApplicationsForOpportunity(actor: Actor, opportunityId: string) {
  const db = getDb();
  const [opp] = await db.select().from(opportunities).where(eq(opportunities.id, opportunityId)).limit(1);
  if (!opp) throw notFound("That opportunity");
  assertOrgMember(actor, opp.organisationId);
  return db.select().from(applications).where(eq(applications.opportunityId, opportunityId)).orderBy(desc(applications.createdAt));
}

export async function listOrganisationApplications(actor: Actor) {
  const orgIds = approvedOrgIds(actor);
  if (!orgIds.length) return [];
  return getDb()
    .select({ application: applications, opportunityTitle: opportunities.title })
    .from(applications)
    .innerJoin(opportunities, eq(opportunities.id, applications.opportunityId))
    .where(inArray(applications.organisationId, orgIds))
    .orderBy(desc(applications.updatedAt))
    .limit(200);
}

export interface EmployerApplicationView {
  application: typeof applications.$inferSelect;
  opportunity: typeof opportunities.$inferSelect;
  /** Null once the candidate withdraws or deletes their account. */
  snapshot: ProfileView | null;
  snapshotTakenAt: string | null;
  snapshotIncludesEvidence: boolean;
  events: { toStatus: string; fromStatus: string | null; note: string | null; createdAt: Date; actorName: string | null }[];
  notes: { id: string; body: string; createdAt: Date; authorUserId: string | null }[];
  comparison: ReturnType<typeof compareProfileToOpportunity> | null;
  introduction: { status: string; createdAt: Date } | null;
}

export async function getApplicationForEmployer(actor: Actor, applicationId: string): Promise<EmployerApplicationView> {
  const app = await employerApplication(actor, applicationId);
  const db = getDb();
  const [opp] = await db.select().from(opportunities).where(eq(opportunities.id, app.opportunityId));
  const [snap] = app.snapshotId ? await db.select().from(profileSnapshots).where(eq(profileSnapshots.id, app.snapshotId)) : [];
  const snapshot = app.status !== "withdrawn" && snap ? (snap.data as ProfileView) : null;
  const events = await db
    .select({ toStatus: applicationEvents.toStatus, fromStatus: applicationEvents.fromStatus, note: applicationEvents.note, createdAt: applicationEvents.createdAt, actorName: users.displayName })
    .from(applicationEvents)
    .leftJoin(users, eq(users.id, applicationEvents.actorUserId))
    .where(eq(applicationEvents.applicationId, applicationId))
    .orderBy(asc(applicationEvents.createdAt));
  const notes = await listApplicationNotes(actor, applicationId);
  const [intro] = await db
    .select({ status: introductionRequests.status, createdAt: introductionRequests.createdAt })
    .from(introductionRequests)
    .where(eq(introductionRequests.applicationId, applicationId))
    .orderBy(desc(introductionRequests.createdAt))
    .limit(1);
  return {
    application: app,
    opportunity: opp,
    snapshot,
    snapshotTakenAt: snap?.createdAt.toISOString() ?? null,
    snapshotIncludesEvidence: !!snap?.includeEvidence,
    events,
    notes,
    comparison: snapshot ? compareProfileToOpportunity(snapshot, opp, await listRequirements(opp.id)) : null,
    introduction: intro ?? null,
  };
}

const employerSettableStatuses: ApplicationStatus[] = ["in_review", "shortlisted", "interviewing", "offer", "not_progressing"];

/** Status changes are always a person's decision and are recorded with who made them. */
export async function setApplicationStatus(actor: Actor, applicationId: string, status: string, note?: string | null) {
  if (!employerSettableStatuses.includes(status as ApplicationStatus)) throw validationError({ status: "Choose a valid status." });
  const app = await employerApplication(actor, applicationId);
  if (app.status === "withdrawn") throw conflict("The candidate withdrew this application.");
  const db = getDb();
  await db.update(applications).set({ status: status as ApplicationStatus, updatedAt: new Date() }).where(eq(applications.id, applicationId));
  await db.insert(applicationEvents).values({ applicationId, actorUserId: actor.userId, fromStatus: app.status, toStatus: status as ApplicationStatus, note: note?.slice(0, 500) || null });
  await audit({ actorUserId: actor.userId, action: "application.status_changed", targetType: "application", targetId: applicationId, organisationId: app.organisationId, metadata: { from: app.status, to: status } });
}

/* Notes and shortlists are organisation-private and also protected by row-level security. */

export async function listApplicationNotes(actor: Actor, applicationId: string) {
  const app = await employerApplication(actor, applicationId);
  return withOrgRls(actor.userId, (tx) =>
    tx
      .select({ id: applicationNotes.id, body: applicationNotes.body, createdAt: applicationNotes.createdAt, authorUserId: applicationNotes.authorUserId })
      .from(applicationNotes)
      .where(eq(applicationNotes.applicationId, app.id))
      .orderBy(asc(applicationNotes.createdAt)),
  );
}

export async function addApplicationNote(actor: Actor, applicationId: string, body: string) {
  const text = body.trim();
  if (!text) throw validationError({ body: "Write a note first." });
  if (text.length > 4000) throw validationError({ body: "Keep notes under 4,000 characters." });
  const app = await employerApplication(actor, applicationId);
  await withOrgRls(actor.userId, (tx) => tx.insert(applicationNotes).values({ applicationId: app.id, organisationId: app.organisationId, authorUserId: actor.userId, body: text }));
}

function discoveryOrg(actor: Actor): string {
  if (!canDiscoverTalent(actor)) throw forbidden("Shortlists open once an administrator approves your organisation.");
  return approvedOrgIds(actor)[0];
}

export async function createShortlist(actor: Actor, input: unknown) {
  const organisationId = discoveryOrg(actor);
  const parsed = shortlistSchema.safeParse(input);
  if (!parsed.success) throw validationError(fieldErrorsFrom(parsed.error));
  if (parsed.data.opportunityId) {
    const [opp] = await getDb().select({ org: opportunities.organisationId }).from(opportunities).where(eq(opportunities.id, parsed.data.opportunityId));
    if (!opp || opp.org !== organisationId) throw notFound("That opportunity");
  }
  const [row] = await withOrgRls(actor.userId, (tx) =>
    tx.insert(shortlists).values({ ...parsed.data, organisationId, createdBy: actor.userId }).returning({ id: shortlists.id }),
  );
  return row.id;
}

export async function listShortlists(actor: Actor) {
  const organisationId = discoveryOrg(actor);
  return withOrgRls(actor.userId, async (tx) => {
    const lists = await tx.select().from(shortlists).where(eq(shortlists.organisationId, organisationId)).orderBy(desc(shortlists.createdAt));
    const entries = lists.length
      ? await tx.select({ shortlistId: shortlistEntries.shortlistId, profileId: shortlistEntries.profileId }).from(shortlistEntries).where(inArray(shortlistEntries.shortlistId, lists.map((l) => l.id)))
      : [];
    return lists.map((l) => ({ ...l, entryCount: entries.filter((e) => e.shortlistId === l.id).length, profileIds: entries.filter((e) => e.shortlistId === l.id).map((e) => e.profileId) }));
  });
}

export async function getShortlist(actor: Actor, shortlistId: string) {
  discoveryOrg(actor);
  const { list, entries } = await withOrgRls(actor.userId, async (tx) => {
    // Row-level security limits these reads to the actor's organisation even without an organisation filter.
    const [list] = await tx.select().from(shortlists).where(eq(shortlists.id, shortlistId)).limit(1);
    const entries = list ? await tx.select().from(shortlistEntries).where(eq(shortlistEntries.shortlistId, list.id)).orderBy(asc(shortlistEntries.createdAt)) : [];
    return { list, entries };
  });
  if (!list) throw notFound("That shortlist");
  const db = getDb();
  const profiles = entries.length ? await db.select().from(talentProfiles).where(inArray(talentProfiles.id, entries.map((e) => e.profileId))) : [];
  const views = await Promise.all(
    entries.map(async (e) => {
      const profile = profiles.find((p) => p.id === e.profileId);
      // If the candidate has since made their profile private, the entry stays but the profile is hidden.
      const audience = profile ? await resolveAudience(actor, profile, list.organisationId) : null;
      return { entry: e, view: profile && audience ? await buildProfileView(profile, audience) : null };
    }),
  );
  return { list, entries: views };
}

export async function addToShortlist(actor: Actor, shortlistId: string, profileId: string, note?: string | null) {
  discoveryOrg(actor);
  const [profile] = await getDb().select().from(talentProfiles).where(eq(talentProfiles.id, profileId)).limit(1);
  const audience = profile ? await resolveAudience(actor, profile) : null;
  if (!profile || !audience || audience.kind !== "employer") throw notFound("That profile");
  await withOrgRls(actor.userId, async (tx) => {
    const [list] = await tx.select().from(shortlists).where(eq(shortlists.id, shortlistId)).limit(1);
    if (!list) throw notFound("That shortlist");
    await tx
      .insert(shortlistEntries)
      .values({ shortlistId: list.id, organisationId: list.organisationId, profileId, note: note?.slice(0, 1000) || null, addedBy: actor.userId })
      .onConflictDoNothing();
  });
}

export async function removeFromShortlist(actor: Actor, entryId: string) {
  discoveryOrg(actor);
  const res = await withOrgRls(actor.userId, (tx) => tx.delete(shortlistEntries).where(eq(shortlistEntries.id, entryId)).returning({ id: shortlistEntries.id }));
  if (!res.length) throw notFound();
}

export async function updateShortlistNote(actor: Actor, entryId: string, note: string) {
  discoveryOrg(actor);
  const res = await withOrgRls(actor.userId, (tx) =>
    tx.update(shortlistEntries).set({ note: note.trim().slice(0, 1000) || null }).where(eq(shortlistEntries.id, entryId)).returning({ id: shortlistEntries.id }),
  );
  if (!res.length) throw notFound();
}

export async function deleteShortlist(actor: Actor, shortlistId: string) {
  discoveryOrg(actor);
  const res = await withOrgRls(actor.userId, (tx) => tx.delete(shortlists).where(eq(shortlists.id, shortlistId)).returning({ id: shortlists.id }));
  if (!res.length) throw notFound();
}

/* ------------------------------------------------------------------ */
/* Talent profiles for employers, and introductions                   */
/* ------------------------------------------------------------------ */

export async function getTalentForEmployer(actor: Actor, profileId: string) {
  if (!canDiscoverTalent(actor)) throw notFound("That profile");
  const [profile] = await getDb().select().from(talentProfiles).where(eq(talentProfiles.id, profileId)).limit(1);
  const audience = profile ? await resolveAudience(actor, profile) : null;
  if (!profile || !audience || audience.kind !== "employer") throw notFound("That profile");
  return { view: await buildProfileView(profile, audience), organisationId: audience.organisationId, grants: audience.grants };
}

/** Employers can ask to be introduced. Contact details are released only if the candidate accepts. */
export async function requestIntroduction(actor: Actor, input: unknown) {
  const parsed = introductionSchema.safeParse(input);
  if (!parsed.success) throw validationError(fieldErrorsFrom(parsed.error));
  const { profileId, opportunityId, applicationId, message } = parsed.data;
  const orgIds = approvedOrgIds(actor);
  if (!orgIds.length) throw notFound("That profile");
  const db = getDb();
  let organisationId = orgIds[0];

  if (applicationId) {
    const app = await employerApplication(actor, applicationId);
    if (app.profileId !== profileId || app.status === "withdrawn") throw notFound("That application");
    organisationId = app.organisationId;
  } else {
    const [profile] = await db.select().from(talentProfiles).where(eq(talentProfiles.id, profileId)).limit(1);
    const audience = profile ? await resolveAudience(actor, profile) : null;
    if (!audience || audience.kind !== "employer") throw notFound("That profile");
  }
  if (opportunityId) {
    const [opp] = await db.select({ org: opportunities.organisationId }).from(opportunities).where(eq(opportunities.id, opportunityId));
    if (!opp || opp.org !== organisationId) throw notFound("That opportunity");
  }
  const [pending] = await db
    .select({ id: introductionRequests.id })
    .from(introductionRequests)
    .where(and(eq(introductionRequests.profileId, profileId), eq(introductionRequests.organisationId, organisationId), eq(introductionRequests.status, "pending")))
    .limit(1);
  if (pending) throw conflict("Your organisation already has a pending introduction request with this person.");

  const [row] = await db
    .insert(introductionRequests)
    .values({ organisationId, profileId, opportunityId, applicationId, requestedBy: actor.userId, message })
    .returning({ id: introductionRequests.id });
  if (applicationId) {
    const app = await employerApplication(actor, applicationId);
    if (app.status !== "introduction_requested") {
      await db.update(applications).set({ status: "introduction_requested", updatedAt: new Date() }).where(eq(applications.id, applicationId));
      await db.insert(applicationEvents).values({ applicationId, actorUserId: actor.userId, fromStatus: app.status, toStatus: "introduction_requested" });
    }
  }
  await audit({ actorUserId: actor.userId, action: "introduction.requested", targetType: "introduction", targetId: row.id, organisationId });
  return row.id;
}

export async function listOrganisationIntroductions(actor: Actor) {
  const orgIds = approvedOrgIds(actor);
  if (!orgIds.length) return [];
  return getDb()
    .select({ request: introductionRequests, candidateName: talentProfiles.fullName })
    .from(introductionRequests)
    .innerJoin(talentProfiles, eq(talentProfiles.id, introductionRequests.profileId))
    .where(inArray(introductionRequests.organisationId, orgIds))
    .orderBy(desc(introductionRequests.createdAt));
}
