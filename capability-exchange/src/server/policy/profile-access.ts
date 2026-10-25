import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { accessGrants, talentProfiles } from "@/server/db/schema";
import { approvedOrgIds, type Actor } from "./actor";

export type TalentProfileRow = typeof talentProfiles.$inferSelect;
export type GrantScope = "contact" | "evidence" | "references";

/**
 * Who is looking at a profile. Each audience sees a different subset of the data;
 * `buildProfileView` is the only place that subset is decided.
 */
export type Audience =
  | { kind: "owner" }
  | { kind: "admin" }
  | { kind: "employer"; organisationId: string; grants: GrantScope[] }
  | { kind: "share"; includeContact: boolean; includeEvidence: boolean }
  /** Building an application snapshot: the "approved employer" view plus the options the candidate ticked. */
  | { kind: "snapshot"; includeContact: boolean; includeEvidence: boolean };

export async function activeGrants(profileId: string, organisationId: string): Promise<GrantScope[]> {
  const rows = await getDb()
    .select({ scope: accessGrants.scope })
    .from(accessGrants)
    .where(and(eq(accessGrants.profileId, profileId), eq(accessGrants.organisationId, organisationId), isNull(accessGrants.revokedAt)));
  return Array.from(new Set(rows.map((r) => r.scope)));
}

/**
 * Decides whether, and as whom, an actor may view a live profile. Returns null when
 * they may not, which callers must treat as "not found".
 *
 * - The owner always sees everything.
 * - Platform administrators see the profile for moderation and verification.
 * - Members of an approved organisation see it only when the candidate has made it
 *   visible to approved employers. Per-organisation grants (from accepted
 *   introductions or applications) add contact details, evidence or references.
 *   Anything else, including a private profile, is not found.
 */
export async function resolveAudience(actor: Actor | null, profile: Pick<TalentProfileRow, "id" | "userId" | "visibility">, organisationId?: string): Promise<Audience | null> {
  if (!actor) return null;
  if (actor.userId === profile.userId) return { kind: "owner" };
  if (actor.isAdmin && !organisationId) return { kind: "admin" };
  const orgIds = approvedOrgIds(actor);
  if (!orgIds.length) return null;
  const orgId = organisationId && orgIds.includes(organisationId) ? organisationId : orgIds[0];
  if (organisationId && orgId !== organisationId) return null;
  if (profile.visibility !== "approved_employers") return null;
  return { kind: "employer", organisationId: orgId, grants: await activeGrants(profile.id, orgId) };
}

/** Item-level rule shared by every record type that has a visibility field. */
export function itemVisibleTo(audience: Audience, visibility: "private" | "approved_employers"): boolean {
  if (audience.kind === "owner" || audience.kind === "admin") return true;
  return visibility === "approved_employers";
}

export function contactVisibleTo(audience: Audience, profile: Pick<TalentProfileRow, "contactVisibility">): boolean {
  switch (audience.kind) {
    case "owner":
    case "admin":
      return true;
    case "employer":
      return profile.contactVisibility === "approved_employers" || audience.grants.includes("contact");
    case "share":
    case "snapshot":
      return audience.includeContact;
  }
}

export function evidenceVisibleTo(
  audience: Audience,
  profile: Pick<TalentProfileRow, "evidenceVisibility">,
  itemVisibility: "private" | "approved_employers",
): boolean {
  switch (audience.kind) {
    case "owner":
    case "admin":
      return true;
    case "employer":
      return itemVisibility === "approved_employers" && (profile.evidenceVisibility === "approved_employers" || audience.grants.includes("evidence"));
    case "share":
    case "snapshot":
      return audience.includeEvidence && itemVisibility === "approved_employers";
  }
}

export function compensationVisibleTo(audience: Audience, profile: Pick<TalentProfileRow, "compensationVisibility">): boolean {
  if (audience.kind === "owner" || audience.kind === "admin") return true;
  return profile.compensationVisibility === "approved_employers";
}

/** Reference contact details: owner, or an organisation the candidate granted access to, and only if the reference consented to contact. */
export function refereeContactVisibleTo(audience: Audience, consentToContact: boolean): boolean {
  if (audience.kind === "owner") return true;
  return audience.kind === "employer" && audience.grants.includes("references") && consentToContact;
}
