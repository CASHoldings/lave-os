import { randomUUID, createHash } from "node:crypto";
import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/server/db/client";
import {
  applications,
  capabilities,
  claimEvidence,
  claims,
  engagementCapabilities,
  engagements,
  evidenceItems,
  organisations,
  profileSnapshots,
  shareLinks,
  talentProfiles,
} from "@/server/db/schema";
import { claimSchema, engagementSchema, evidenceFileMetaSchema, evidenceLinkSchema, fieldErrorsFrom } from "@/lib/validation";
import { assertTalent, approvedOrgIds, type Actor } from "@/server/policy/actor";
import { evidenceVisibleTo, resolveAudience, type Audience } from "@/server/policy/profile-access";
import { notFound, validationError, conflict } from "@/server/errors";
import { checkUpload, getStorage, safeFileName } from "@/server/storage";
import { sha256 } from "@/server/crypto";
import { profileChanged } from "./profile";
import { audit } from "./audit";

/* ------------------------------------------------------------------ */
/* Engagements                                                         */
/* ------------------------------------------------------------------ */

async function ownedEngagement(profileId: string, engagementId: string, db: DbOrTx = getDb()) {
  const [row] = await db.select().from(engagements).where(and(eq(engagements.id, engagementId), eq(engagements.profileId, profileId))).limit(1);
  if (!row) throw notFound("That project");
  return row;
}

async function setEngagementCapabilities(engagementId: string, capabilityIds: string[], db: DbOrTx) {
  await db.delete(engagementCapabilities).where(eq(engagementCapabilities.engagementId, engagementId));
  if (!capabilityIds.length) return;
  const existing = await db.select({ id: capabilities.id }).from(capabilities).where(inArray(capabilities.id, capabilityIds));
  if (existing.length) await db.insert(engagementCapabilities).values(existing.map((c) => ({ engagementId, capabilityId: c.id })));
}

export async function saveEngagement(actor: Actor, input: unknown, engagementId?: string | null) {
  const profileId = assertTalent(actor);
  const parsed = engagementSchema.safeParse(input);
  if (!parsed.success) throw validationError(fieldErrorsFrom(parsed.error));
  const { capabilityIds, ...data } = parsed.data;
  const db = getDb();
  let id: string;
  if (engagementId) {
    await ownedEngagement(profileId, engagementId);
    await db.update(engagements).set({ ...data, updatedAt: new Date() }).where(eq(engagements.id, engagementId));
    id = engagementId;
  } else {
    const [row] = await db.insert(engagements).values({ ...data, profileId }).returning({ id: engagements.id });
    id = row.id;
  }
  await setEngagementCapabilities(id, capabilityIds, db);
  await profileChanged(profileId);
  return id;
}

export async function deleteEngagement(actor: Actor, engagementId: string) {
  const profileId = assertTalent(actor);
  await ownedEngagement(profileId, engagementId);
  const db = getDb();
  // Claims about this project are removed with it; evidence files stay in the library.
  await db.delete(claims).where(and(eq(claims.engagementId, engagementId), eq(claims.profileId, profileId)));
  await db.delete(engagements).where(eq(engagements.id, engagementId));
  await profileChanged(profileId);
}

/* ------------------------------------------------------------------ */
/* Claims                                                              */
/* ------------------------------------------------------------------ */

async function ownedClaim(profileId: string, claimId: string, db: DbOrTx = getDb()) {
  const [row] = await db.select().from(claims).where(and(eq(claims.id, claimId), eq(claims.profileId, profileId))).limit(1);
  if (!row) throw notFound("That claim");
  return row;
}

/**
 * Moves a claim between "self-reported" and "evidence supplied" as evidence is attached
 * or removed. Reviewer decisions are never set here: only a verification review can
 * make a claim "independently verified".
 */
export async function recomputeClaimStatus(claimId: string, db: DbOrTx = getDb()) {
  const [claim] = await db.select().from(claims).where(eq(claims.id, claimId));
  if (!claim) return;
  if (claim.verificationStatus === "independently_verified" || claim.verificationStatus === "clarification_requested") return;
  const [{ n }] = await db.select({ n: count() }).from(claimEvidence).where(eq(claimEvidence.claimId, claimId));
  const next = n > 0 ? "evidence_supplied" : "self_reported";
  if (next !== claim.verificationStatus) await db.update(claims).set({ verificationStatus: next }).where(eq(claims.id, claimId));
}

export async function saveClaim(actor: Actor, input: unknown, claimId?: string | null) {
  const profileId = assertTalent(actor);
  const parsed = claimSchema.safeParse(input);
  if (!parsed.success) throw validationError(fieldErrorsFrom(parsed.error));
  const data = parsed.data;
  if (data.engagementId) await ownedEngagement(profileId, data.engagementId);
  const db = getDb();
  let id: string;
  if (claimId) {
    const existing = await ownedClaim(profileId, claimId);
    const textChanged = existing.text.trim() !== data.text.trim();
    // Changing the wording of a reviewed claim means the review no longer applies to it.
    const resetReview = textChanged && (existing.verificationStatus === "independently_verified" || existing.verificationStatus === "clarification_requested");
    await db
      .update(claims)
      .set({
        ...data,
        lastConfirmedAt: new Date(),
        updatedAt: new Date(),
        ...(resetReview ? { verificationStatus: "self_reported" as const, verificationRequestedAt: null } : {}),
      })
      .where(eq(claims.id, claimId));
    if (resetReview) {
      await recomputeClaimStatus(claimId);
      await audit({ actorUserId: actor.userId, action: "claim.review_reset_by_edit", targetType: "claim", targetId: claimId, metadata: { from: existing.verificationStatus } });
    }
    id = claimId;
  } else {
    const [row] = await db
      .insert(claims)
      .values({ ...data, profileId, source: "candidate", authorUserId: actor.userId, verificationStatus: "self_reported" })
      .returning({ id: claims.id });
    id = row.id;
  }
  await profileChanged(profileId);
  return id;
}

export async function deleteClaim(actor: Actor, claimId: string) {
  const profileId = assertTalent(actor);
  await ownedClaim(profileId, claimId);
  await getDb().delete(claims).where(eq(claims.id, claimId));
  await profileChanged(profileId);
}

export async function confirmClaim(actor: Actor, claimId: string) {
  const profileId = assertTalent(actor);
  await ownedClaim(profileId, claimId);
  await getDb().update(claims).set({ lastConfirmedAt: new Date() }).where(eq(claims.id, claimId));
}

export async function requestVerification(actor: Actor, claimId: string) {
  const profileId = assertTalent(actor);
  const claim = await ownedClaim(profileId, claimId);
  const [{ n }] = await getDb().select({ n: count() }).from(claimEvidence).where(eq(claimEvidence.claimId, claimId));
  if (n === 0) throw validationError({ _form: "Attach at least one piece of evidence before requesting verification." });
  if (claim.verificationStatus === "independently_verified") throw conflict("This claim is already independently verified.");
  await getDb().update(claims).set({ verificationRequestedAt: new Date() }).where(eq(claims.id, claimId));
  await audit({ actorUserId: actor.userId, action: "claim.verification_requested", targetType: "claim", targetId: claimId });
}

/* ------------------------------------------------------------------ */
/* Evidence                                                            */
/* ------------------------------------------------------------------ */

async function ownedEvidence(profileId: string, evidenceId: string, db: DbOrTx = getDb()) {
  const [row] = await db.select().from(evidenceItems).where(and(eq(evidenceItems.id, evidenceId), eq(evidenceItems.profileId, profileId))).limit(1);
  if (!row) throw notFound("That evidence");
  return row;
}

export async function addEvidenceLink(actor: Actor, input: unknown, claimId?: string | null) {
  const profileId = assertTalent(actor);
  const parsed = evidenceLinkSchema.safeParse(input);
  if (!parsed.success) throw validationError(fieldErrorsFrom(parsed.error));
  if (claimId) await ownedClaim(profileId, claimId);
  const [row] = await getDb()
    .insert(evidenceItems)
    .values({ profileId, kind: "link", title: parsed.data.title, description: parsed.data.description, url: parsed.data.url, visibility: parsed.data.visibility })
    .returning({ id: evidenceItems.id });
  if (claimId) await attachEvidence(actor, claimId, row.id);
  await profileChanged(profileId);
  return row.id;
}

export async function uploadEvidenceFile(actor: Actor, meta: unknown, file: { name: string; type: string; bytes: Uint8Array }) {
  const profileId = assertTalent(actor);
  const parsed = evidenceFileMetaSchema.safeParse(meta);
  if (!parsed.success) throw validationError(fieldErrorsFrom(parsed.error));
  const problem = checkUpload(file);
  if (problem) throw validationError({ file: problem });
  if (parsed.data.claimId) await ownedClaim(profileId, parsed.data.claimId);

  // Keys are random identifiers: no names or file names in storage paths.
  const storageKey = `evidence/${profileId}/${randomUUID()}`;
  await getStorage().put(storageKey, file.bytes, file.type);
  const [row] = await getDb()
    .insert(evidenceItems)
    .values({
      profileId,
      kind: "file",
      title: parsed.data.title,
      description: parsed.data.description,
      storageKey,
      fileName: safeFileName(file.name),
      mimeType: file.type,
      sizeBytes: file.bytes.length,
      sha256: createHash("sha256").update(file.bytes).digest("hex"),
      isRedacted: parsed.data.isRedacted,
      redactionNote: parsed.data.redactionNote,
      visibility: parsed.data.visibility,
    })
    .returning({ id: evidenceItems.id });
  // Uploading never verifies anything: at most it moves an attached claim to "evidence supplied".
  if (parsed.data.claimId) await attachEvidence(actor, parsed.data.claimId, row.id);
  await audit({ actorUserId: actor.userId, action: "evidence.uploaded", targetType: "evidence", targetId: row.id, metadata: { visibility: parsed.data.visibility } });
  await profileChanged(profileId);
  return row.id;
}

export async function updateEvidenceVisibility(actor: Actor, evidenceId: string, visibility: "private" | "approved_employers") {
  const profileId = assertTalent(actor);
  await ownedEvidence(profileId, evidenceId);
  await getDb().update(evidenceItems).set({ visibility }).where(eq(evidenceItems.id, evidenceId));
  await audit({ actorUserId: actor.userId, action: "evidence.visibility_changed", targetType: "evidence", targetId: evidenceId, metadata: { visibility } });
}

export async function attachEvidence(actor: Actor, claimId: string, evidenceId: string) {
  const profileId = assertTalent(actor);
  await ownedClaim(profileId, claimId);
  await ownedEvidence(profileId, evidenceId);
  await getDb().insert(claimEvidence).values({ claimId, evidenceId }).onConflictDoNothing();
  await recomputeClaimStatus(claimId);
}

export async function detachEvidence(actor: Actor, claimId: string, evidenceId: string) {
  const profileId = assertTalent(actor);
  await ownedClaim(profileId, claimId);
  await getDb().delete(claimEvidence).where(and(eq(claimEvidence.claimId, claimId), eq(claimEvidence.evidenceId, evidenceId)));
  await recomputeClaimStatus(claimId);
}

/** Deletes the evidence record, the stored file and any derived text, then updates affected claims. */
export async function deleteEvidence(actor: Actor, evidenceId: string) {
  const profileId = assertTalent(actor);
  const item = await ownedEvidence(profileId, evidenceId);
  const db = getDb();
  const linked = await db.select({ claimId: claimEvidence.claimId }).from(claimEvidence).where(eq(claimEvidence.evidenceId, evidenceId));
  if (item.storageKey) await getStorage().remove(item.storageKey);
  await db.delete(evidenceItems).where(eq(evidenceItems.id, evidenceId));
  for (const l of linked) await recomputeClaimStatus(l.claimId);
  await audit({ actorUserId: actor.userId, action: "evidence.deleted", targetType: "evidence", targetId: evidenceId });
  await profileChanged(profileId);
}

/* ------------------------------------------------------------------ */
/* Authorised downloads                                                */
/* ------------------------------------------------------------------ */

export type DownloadContext =
  | { kind: "live"; actor: Actor | null }
  | { kind: "share"; token: string }
  | { kind: "application"; actor: Actor | null; applicationId: string };

/**
 * Decides whether a file may be downloaded in the given context and returns a
 * short-lived URL. Every refusal is "not found" so ids cannot be probed.
 */
export async function authoriseEvidenceDownload(ctx: DownloadContext, evidenceId: string): Promise<{ url: string }> {
  const db = getDb();
  const [item] = await db.select().from(evidenceItems).where(eq(evidenceItems.id, evidenceId)).limit(1);
  if (!item || item.kind !== "file" || !item.storageKey) throw notFound("That file");
  const [profile] = await db.select().from(talentProfiles).where(eq(talentProfiles.id, item.profileId)).limit(1);
  if (!profile) throw notFound("That file");

  let allowed = false;
  let actorUserId: string | null = null;
  let audience: Audience | null = null;

  if (ctx.kind === "live") {
    actorUserId = ctx.actor?.userId ?? null;
    audience = await resolveAudience(ctx.actor, profile);
    allowed = !!audience && evidenceVisibleTo(audience, profile, item.visibility);
  } else if (ctx.kind === "share") {
    const link = await activeShareLink(ctx.token);
    if (link && link.profileId === profile.id) {
      audience = { kind: "share", includeContact: link.includeContact, includeEvidence: link.includeEvidence };
      allowed = evidenceVisibleTo(audience, profile, item.visibility);
    }
  } else {
    actorUserId = ctx.actor?.userId ?? null;
    if (ctx.actor) {
      const [app] = await db
        .select({ app: applications, snapshot: profileSnapshots, orgStatus: organisations.status })
        .from(applications)
        .innerJoin(organisations, eq(organisations.id, applications.organisationId))
        .leftJoin(profileSnapshots, eq(profileSnapshots.id, applications.snapshotId))
        .where(eq(applications.id, ctx.applicationId))
        .limit(1);
      if (
        app &&
        app.snapshot &&
        app.app.profileId === profile.id &&
        app.app.status !== "withdrawn" &&
        approvedOrgIds(ctx.actor).includes(app.app.organisationId) &&
        app.snapshot.includeEvidence
      ) {
        const snapEvidence = ((app.snapshot.data as { evidence?: { id: string }[] }).evidence ?? []).map((e) => e.id);
        // The file must have been shared in the snapshot and still be shareable now.
        allowed = snapEvidence.includes(item.id) && item.visibility === "approved_employers";
        audience = { kind: "snapshot", includeContact: app.snapshot.includeContact, includeEvidence: true };
      }
    }
  }

  if (!allowed) throw notFound("That file");
  if (audience?.kind === "admin" || audience?.kind === "employer" || ctx.kind === "application") {
    await audit({ actorUserId, actorRole: audience?.kind, action: "evidence.downloaded", targetType: "evidence", targetId: item.id, metadata: { kind: ctx.kind } });
  }
  const url = await getStorage().signedDownloadUrl(item.storageKey, { fileName: item.fileName ?? "evidence", contentType: item.mimeType ?? "application/octet-stream" });
  return { url };
}

/** A share link that exists, is not revoked and has not expired. */
export async function activeShareLink(token: string) {
  if (!token || token.length < 20 || token.length > 200) return null;
  const [link] = await getDb()
    .select()
    .from(shareLinks)
    .where(and(eq(shareLinks.tokenHash, sha256(token)), isNull(shareLinks.revokedAt)))
    .limit(1);
  if (!link || link.expiresAt.getTime() <= Date.now()) return null;
  return link;
}
