import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/server/db/client";
import { accessGrants, introductionRequests, organisations, profileSnapshots, shareLinks, talentProfiles, opportunities, applications } from "@/server/db/schema";
import { fieldErrorsFrom, shareLinkSchema } from "@/lib/validation";
import { assertTalent, type Actor } from "@/server/policy/actor";
import { notFound, validationError } from "@/server/errors";
import { randomToken, sha256 } from "@/server/crypto";
import { buildProfileView, type ProfileView } from "./profile-view";
import { activeShareLink } from "./portfolio";
import { audit } from "./audit";

/* ------------------------------------------------------------------ */
/* Share links                                                         */
/* ------------------------------------------------------------------ */

/** Creates a link and returns the token once. Only a hash of it is stored, so it cannot be shown again. */
export async function createShareLink(actor: Actor, input: unknown) {
  const profileId = assertTalent(actor);
  const parsed = shareLinkSchema.safeParse(input);
  if (!parsed.success) throw validationError(fieldErrorsFrom(parsed.error));
  const token = randomToken(24);
  const expiresAt = new Date(Date.now() + parsed.data.expiresInDays * 86400_000);
  const [row] = await getDb()
    .insert(shareLinks)
    .values({
      profileId,
      tokenHash: sha256(token),
      label: parsed.data.label,
      includeContact: parsed.data.includeContact,
      includeEvidence: parsed.data.includeEvidence,
      expiresAt,
    })
    .returning({ id: shareLinks.id });
  await audit({
    actorUserId: actor.userId,
    action: "share_link.created",
    targetType: "share_link",
    targetId: row.id,
    metadata: { includeContact: parsed.data.includeContact, includeEvidence: parsed.data.includeEvidence, expiresAt: expiresAt.toISOString() },
  });
  return { id: row.id, token, expiresAt };
}

export async function listShareLinks(actor: Actor) {
  const profileId = assertTalent(actor);
  const rows = await getDb().select().from(shareLinks).where(eq(shareLinks.profileId, profileId)).orderBy(desc(shareLinks.createdAt));
  const now = Date.now();
  return rows.map((l) => ({ ...l, status: l.revokedAt ? ("revoked" as const) : l.expiresAt.getTime() <= now ? ("expired" as const) : ("active" as const) }));
}

export async function revokeShareLink(actor: Actor, linkId: string) {
  const profileId = assertTalent(actor);
  const res = await getDb()
    .update(shareLinks)
    .set({ revokedAt: new Date() })
    .where(and(eq(shareLinks.id, linkId), eq(shareLinks.profileId, profileId), isNull(shareLinks.revokedAt)))
    .returning({ id: shareLinks.id });
  if (!res.length) throw notFound("That link");
  await audit({ actorUserId: actor.userId, action: "share_link.revoked", targetType: "share_link", targetId: linkId });
}

/** The view behind a share link. Revoked or expired links behave exactly like links that never existed. */
export async function viewSharedProfile(token: string): Promise<{ view: ProfileView; expiresAt: Date; includeEvidence: boolean } | null> {
  const link = await activeShareLink(token);
  if (!link) return null;
  const db = getDb();
  const [profile] = await db.select().from(talentProfiles).where(eq(talentProfiles.id, link.profileId)).limit(1);
  if (!profile) return null;
  await db
    .update(shareLinks)
    .set({ accessCount: sql`${shareLinks.accessCount} + 1`, lastAccessedAt: new Date() })
    .where(eq(shareLinks.id, link.id));
  const view = await buildProfileView(profile, { kind: "share", includeContact: link.includeContact, includeEvidence: link.includeEvidence });
  return { view, expiresAt: link.expiresAt, includeEvidence: link.includeEvidence };
}

/* ------------------------------------------------------------------ */
/* Per-organisation grants                                            */
/* ------------------------------------------------------------------ */

export async function grantAccess(profileId: string, organisationId: string, scope: "contact" | "evidence" | "references", source: "application" | "introduction" | "manual", db: DbOrTx = getDb()) {
  const [existing] = await db
    .select({ id: accessGrants.id })
    .from(accessGrants)
    .where(and(eq(accessGrants.profileId, profileId), eq(accessGrants.organisationId, organisationId), eq(accessGrants.scope, scope), isNull(accessGrants.revokedAt)))
    .limit(1);
  if (existing) return existing.id;
  const [row] = await db.insert(accessGrants).values({ profileId, organisationId, scope, source }).returning({ id: accessGrants.id });
  return row.id;
}

export async function listGrants(actor: Actor) {
  const profileId = assertTalent(actor);
  return getDb()
    .select({ grant: accessGrants, organisationName: organisations.name })
    .from(accessGrants)
    .innerJoin(organisations, eq(organisations.id, accessGrants.organisationId))
    .where(and(eq(accessGrants.profileId, profileId), isNull(accessGrants.revokedAt)))
    .orderBy(desc(accessGrants.grantedAt));
}

export async function revokeGrant(actor: Actor, grantId: string) {
  const profileId = assertTalent(actor);
  const res = await getDb()
    .update(accessGrants)
    .set({ revokedAt: new Date() })
    .where(and(eq(accessGrants.id, grantId), eq(accessGrants.profileId, profileId), isNull(accessGrants.revokedAt)))
    .returning({ id: accessGrants.id, organisationId: accessGrants.organisationId, scope: accessGrants.scope });
  if (!res.length) throw notFound("That permission");
  await audit({ actorUserId: actor.userId, action: "access_grant.revoked", targetType: "access_grant", targetId: grantId, organisationId: res[0].organisationId, metadata: { scope: res[0].scope } });
}

/* ------------------------------------------------------------------ */
/* Introductions (candidate side)                                     */
/* ------------------------------------------------------------------ */

export async function listIntroductionRequests(actor: Actor) {
  const profileId = assertTalent(actor);
  return getDb()
    .select({ request: introductionRequests, organisationName: organisations.name, opportunityTitle: opportunities.title })
    .from(introductionRequests)
    .innerJoin(organisations, eq(organisations.id, introductionRequests.organisationId))
    .leftJoin(opportunities, eq(opportunities.id, introductionRequests.opportunityId))
    .where(eq(introductionRequests.profileId, profileId))
    .orderBy(desc(introductionRequests.createdAt));
}

/** Accepting releases contact details to that organisation only. Declining shares nothing. */
export async function respondToIntroduction(actor: Actor, requestId: string, accept: boolean) {
  const profileId = assertTalent(actor);
  const db = getDb();
  const [req] = await db
    .select()
    .from(introductionRequests)
    .where(and(eq(introductionRequests.id, requestId), eq(introductionRequests.profileId, profileId)))
    .limit(1);
  if (!req || req.status !== "pending") throw notFound("That introduction request");
  await db.transaction(async (tx) => {
    await tx.update(introductionRequests).set({ status: accept ? "accepted" : "declined", respondedAt: new Date() }).where(eq(introductionRequests.id, requestId));
    if (accept) await grantAccess(profileId, req.organisationId, "contact", "introduction", tx);
    if (req.applicationId) {
      await tx
        .update(applications)
        .set({ updatedAt: new Date() })
        .where(eq(applications.id, req.applicationId));
    }
  });
  await audit({
    actorUserId: actor.userId,
    action: accept ? "introduction.accepted" : "introduction.declined",
    targetType: "introduction",
    targetId: requestId,
    organisationId: req.organisationId,
  });
}

/* ------------------------------------------------------------------ */
/* Snapshots                                                           */
/* ------------------------------------------------------------------ */

/**
 * Freezes the approved-employer view of a profile, with the candidate's chosen extras.
 * The view is built before `db` is used, so this is safe to call with a transaction.
 */
export async function createSnapshot(profileId: string, opts: { includeContact: boolean; includeEvidence: boolean }, db: DbOrTx = getDb()) {
  const view = await snapshotView(profileId, opts);
  const [row] = await db
    .insert(profileSnapshots)
    .values({ profileId, data: view, includeContact: opts.includeContact, includeEvidence: opts.includeEvidence })
    .returning({ id: profileSnapshots.id });
  return { id: row.id, view };
}

export async function snapshotView(profileId: string, opts: { includeContact: boolean; includeEvidence: boolean }) {
  const [profile] = await getDb().select().from(talentProfiles).where(eq(talentProfiles.id, profileId)).limit(1);
  if (!profile) throw notFound("Your profile");
  return buildProfileView(profile, { kind: "snapshot", ...opts });
}

export async function previewSnapshot(actor: Actor, opts: { includeContact: boolean; includeEvidence: boolean }) {
  const profileId = assertTalent(actor);
  const [profile] = await getDb().select().from(talentProfiles).where(eq(talentProfiles.id, profileId)).limit(1);
  if (!profile) throw notFound("Your profile");
  return buildProfileView(profile, { kind: "snapshot", ...opts });
}
