import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { organisationMemberships, organisations, talentProfiles, users } from "@/server/db/schema";
import { forbidden, notFound } from "@/server/errors";

export interface Membership {
  organisationId: string;
  organisationName: string;
  organisationStatus: "pending" | "approved" | "rejected" | "suspended";
  role: "owner" | "admin" | "member";
}

/** Everything authorisation decisions need about the signed-in person. Loaded fresh per request. */
export interface Actor {
  userId: string;
  email: string;
  displayName: string;
  accountType: "talent" | "employer";
  isAdmin: boolean;
  isDemo: boolean;
  profileId: string | null;
  memberships: Membership[];
}

export async function loadActor(userId: string): Promise<Actor | null> {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || user.status !== "active") return null;
  const memberships = await db
    .select({
      organisationId: organisations.id,
      organisationName: organisations.name,
      organisationStatus: organisations.status,
      role: organisationMemberships.role,
    })
    .from(organisationMemberships)
    .innerJoin(organisations, eq(organisations.id, organisationMemberships.organisationId))
    .where(eq(organisationMemberships.userId, userId));
  const [profile] = await db.select({ id: talentProfiles.id }).from(talentProfiles).where(eq(talentProfiles.userId, userId)).limit(1);
  return {
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
    accountType: user.accountType,
    isAdmin: user.platformRole === "admin",
    isDemo: user.isDemo,
    profileId: profile?.id ?? null,
    memberships,
  };
}

export const isAdmin = (a: Actor | null | undefined) => !!a?.isAdmin;

export const approvedOrgIds = (a: Actor | null | undefined) =>
  (a?.memberships ?? []).filter((m) => m.organisationStatus === "approved").map((m) => m.organisationId);

/** Talent discovery requires membership of an organisation an administrator has approved. */
export const canDiscoverTalent = (a: Actor | null | undefined) => approvedOrgIds(a).length > 0;

/** The organisation the employer is working in. Users normally belong to one organisation. */
export function primaryMembership(a: Actor | null | undefined): Membership | null {
  if (!a) return null;
  return a.memberships.find((m) => m.organisationStatus === "approved") ?? a.memberships[0] ?? null;
}

export function assertOrgMember(a: Actor, organisationId: string, opts: { requireApproved?: boolean } = {}): Membership {
  const m = a.memberships.find((x) => x.organisationId === organisationId);
  // Not-found rather than forbidden, so organisation ids cannot be probed.
  if (!m) throw notFound();
  if (opts.requireApproved && m.organisationStatus !== "approved") {
    throw forbidden("Your organisation is awaiting approval. Talent discovery and publishing open once an administrator approves it.");
  }
  return m;
}

export function assertOrgManager(a: Actor, organisationId: string): Membership {
  const m = assertOrgMember(a, organisationId);
  if (m.role === "member") throw forbidden("Only organisation owners and admins can do that.");
  return m;
}

export function assertAdmin(a: Actor) {
  if (!a.isAdmin) throw notFound();
}

export function assertTalent(a: Actor): string {
  if (!a.profileId) throw notFound("Your profile");
  return a.profileId;
}
