import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { createClient } from "@supabase/supabase-js";
import { getDb } from "@/server/db/client";
import {
  accessGrants,
  aiSuggestions,
  applicationEvents,
  applications,
  evidenceItems,
  introductionRequests,
  opportunities,
  organisations,
  organisationMemberships,
  profileSnapshots,
  shareLinks,
  talentProfiles,
  users,
  deletionReceipts,
} from "@/server/db/schema";
import type { Actor } from "@/server/policy/actor";
import { getEnv } from "@/config/env";
import { getStorage } from "@/server/storage";
import { sha256 } from "@/server/crypto";
import { conflict, unavailable, validationError } from "@/server/errors";
import { logError } from "@/server/log";
import { buildProfileView } from "./profile-view";
import { audit } from "./audit";

/**
 * Everything the platform holds about the signed-in person, as JSON.
 * Evidence files are listed with their details; each can be downloaded from the Evidence Portfolio.
 */
export async function exportAccountData(actor: Actor) {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId));
  const result: Record<string, unknown> = {
    exportedAt: new Date().toISOString(),
    format: "African Capability Exchange account export, version 1",
    account: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      accountType: user.accountType,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
    },
    organisationMemberships: actor.memberships,
  };
  if (actor.profileId) {
    const [profile] = await db.select().from(talentProfiles).where(eq(talentProfiles.id, actor.profileId));
    const view = await buildProfileView(profile, { kind: "owner" });
    result.profile = view;
    result.shareLinks = (await db.select().from(shareLinks).where(eq(shareLinks.profileId, profile.id))).map((l) => ({
      id: l.id,
      label: l.label,
      includeContact: l.includeContact,
      includeEvidence: l.includeEvidence,
      createdAt: l.createdAt,
      expiresAt: l.expiresAt,
      revokedAt: l.revokedAt,
      accessCount: l.accessCount,
    }));
    result.organisationPermissions = await db
      .select({ organisation: organisations.name, scope: accessGrants.scope, source: accessGrants.source, grantedAt: accessGrants.grantedAt, revokedAt: accessGrants.revokedAt })
      .from(accessGrants)
      .innerJoin(organisations, eq(organisations.id, accessGrants.organisationId))
      .where(eq(accessGrants.profileId, profile.id));
    const apps = await db
      .select({ app: applications, opportunity: opportunities.title, organisation: organisations.name, snapshot: profileSnapshots.data })
      .from(applications)
      .innerJoin(opportunities, eq(opportunities.id, applications.opportunityId))
      .innerJoin(organisations, eq(organisations.id, applications.organisationId))
      .leftJoin(profileSnapshots, eq(profileSnapshots.id, applications.snapshotId))
      .where(eq(applications.profileId, profile.id));
    result.applications = apps.map((a) => ({
      opportunity: a.opportunity,
      organisation: a.organisation,
      status: a.app.status,
      expressionOfInterest: a.app.expressionOfInterest,
      submittedAt: a.app.createdAt,
      sharedSnapshot: a.snapshot,
    }));
    result.introductionRequests = await db
      .select({ organisation: organisations.name, message: introductionRequests.message, status: introductionRequests.status, createdAt: introductionRequests.createdAt })
      .from(introductionRequests)
      .innerJoin(organisations, eq(organisations.id, introductionRequests.organisationId))
      .where(eq(introductionRequests.profileId, profile.id));
  }
  result.aiSuggestions = await db
    .select({ kind: aiSuggestions.kind, status: aiSuggestions.status, output: aiSuggestions.output, provider: aiSuggestions.provider, isDemonstration: aiSuggestions.isDemonstration, createdAt: aiSuggestions.createdAt })
    .from(aiSuggestions)
    .where(eq(aiSuggestions.userId, actor.userId));
  await audit({ actorUserId: actor.userId, action: "account.exported", targetType: "user", targetId: actor.userId });
  return result;
}

/**
 * Permanently deletes the account. Removes stored evidence files first (and stops if
 * storage cannot confirm removal, so no orphaned files remain), then all profile
 * records, derived text, search text, share links, permissions and snapshots.
 * Applications remain in employers' pipelines as anonymous, withdrawn records.
 */
export async function deleteAccount(actor: Actor, confirmation: string) {
  if (confirmation.trim().toUpperCase() !== "DELETE") throw validationError({ confirmation: 'Type DELETE to confirm.' });
  const db = getDb();

  const sole = await db
    .select({ orgId: organisationMemberships.organisationId })
    .from(organisationMemberships)
    .where(and(eq(organisationMemberships.userId, actor.userId), eq(organisationMemberships.role, "owner")));
  for (const s of sole) {
    const owners = await db
      .select({ id: organisationMemberships.id })
      .from(organisationMemberships)
      .where(and(eq(organisationMemberships.organisationId, s.orgId), eq(organisationMemberships.role, "owner")));
    const members = await db.select({ id: organisationMemberships.id }).from(organisationMemberships).where(eq(organisationMemberships.organisationId, s.orgId));
    if (owners.length === 1 && members.length > 1) {
      throw conflict("You are the only owner of an organisation with other members. Make another member an owner before deleting your account.");
    }
  }

  const summary: Record<string, number | string> = {};
  if (actor.profileId) {
    const files = await db
      .select({ id: evidenceItems.id, key: evidenceItems.storageKey })
      .from(evidenceItems)
      .where(and(eq(evidenceItems.profileId, actor.profileId), isNotNull(evidenceItems.storageKey)));
    const storage = getStorage();
    for (const f of files) {
      try {
        await storage.remove(f.key!);
      } catch (e) {
        logError("deletion.storage_failed", e, { evidenceId: f.id });
        throw unavailable("We could not remove all of your files from storage, so nothing has been deleted yet. Please try again shortly.");
      }
    }
    summary.filesRemoved = files.length;

    await db.transaction(async (tx) => {
      const apps = await tx.select({ id: applications.id, status: applications.status }).from(applications).where(eq(applications.profileId, actor.profileId!));
      if (apps.length) {
        await tx
          .update(applications)
          .set({ status: "withdrawn", withdrawnAt: new Date(), snapshotId: null, candidateDisplayName: "Deleted account", expressionOfInterest: "Removed at the candidate's request.", updatedAt: new Date() })
          .where(inArray(applications.id, apps.map((a) => a.id)));
        await tx.insert(applicationEvents).values(apps.filter((a) => a.status !== "withdrawn").map((a) => ({ applicationId: a.id, fromStatus: a.status, toStatus: "withdrawn" as const, note: "Candidate deleted their account." })));
      }
      summary.applicationsAnonymised = apps.length;
      await tx.delete(profileSnapshots).where(eq(profileSnapshots.profileId, actor.profileId!));
      // Cascades remove module answers, capabilities, projects, claims, reviews, evidence
      // records (including derived text), learning, public work, references, share links,
      // permissions, snapshots, shortlist entries, introduction requests and AI suggestions.
      await tx.delete(talentProfiles).where(eq(talentProfiles.id, actor.profileId!));
    });
  }

  const [user] = await db.select().from(users).where(eq(users.id, actor.userId));
  if (user?.authProvider === "supabase" && user.externalAuthId) {
    const env = getEnv();
    if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
      const { error } = await createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY).auth.admin.deleteUser(user.externalAuthId);
      summary.identityProvider = error ? "removal_failed_manual_follow_up_required" : "removed";
    } else {
      summary.identityProvider = "manual_follow_up_required";
    }
  }

  // Removes sessions, memberships and remaining suggestions by cascade.
  await db.delete(users).where(eq(users.id, actor.userId));
  await db.insert(deletionReceipts).values({ userIdHash: sha256(actor.userId), summary });
  await audit({ actorUserId: null, actorRole: "system", action: "account.deleted", targetType: "user", metadata: { count: Number(summary.filesRemoved ?? 0) } });
  return summary;
}
