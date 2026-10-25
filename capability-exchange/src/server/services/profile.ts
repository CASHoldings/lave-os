import { and, count, eq, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/server/db/client";
import {
  capabilities,
  claims,
  engagements,
  learningRecords,
  moduleResponses,
  profileCapabilities,
  publicWorkItems,
  referees,
  talentProfiles,
} from "@/server/db/schema";
import {
  fieldErrorsFrom,
  learningRecordSchema,
  moduleAnswerSchema,
  profileCapabilitySchema,
  profileSections,
  publicWorkSchema,
  refereeSchema,
  visibilitySettingsSchema,
  type ProfileSectionKey,
} from "@/lib/validation";
import { labelOf, moduleByKey, roleFamilies } from "@/config/taxonomy";
import { assertTalent, type Actor } from "@/server/policy/actor";
import { notFound, validationError } from "@/server/errors";
import type { TalentProfileRow } from "@/server/policy/profile-access";
import { audit } from "./audit";

export async function getOwnProfile(actor: Actor): Promise<TalentProfileRow> {
  const profileId = assertTalent(actor);
  const [row] = await getDb().select().from(talentProfiles).where(eq(talentProfiles.id, profileId)).limit(1);
  if (!row) throw notFound("Your profile");
  return row;
}

/* ------------------------------------------------------------------ */
/* Completeness                                                        */
/* ------------------------------------------------------------------ */

export interface CoreStep {
  key: ProfileSectionKey | "capabilities" | "contribution";
  label: string;
  done: boolean;
  href: string;
}

/** The short core profile. Optional items (compensation, contact) never block completion. */
export async function coreSteps(profile: TalentProfileRow, db: DbOrTx = getDb()): Promise<CoreStep[]> {
  const [[{ caps }], [{ engs }]] = await Promise.all([
    db.select({ caps: count() }).from(profileCapabilities).where(eq(profileCapabilities.profileId, profile.id)),
    db.select({ engs: count() }).from(engagements).where(eq(engagements.profileId, profile.id)),
  ]);
  return [
    { key: "basics", label: "Name and professional headline", done: !!(profile.fullName && profile.headline), href: "/talent/profile#basics" },
    { key: "location", label: "Location, time zone and languages", done: !!(profile.locationCountry && profile.timeZone && profile.languages.length), href: "/talent/profile#location" },
    { key: "introduction", label: "Professional introduction", done: !!(profile.introduction && profile.introduction.trim().length >= 80), href: "/talent/profile#introduction" },
    { key: "preferences", label: "Opportunity types and work arrangements", done: profile.opportunityTypes.length > 0 && profile.workArrangements.length > 0, href: "/talent/profile#preferences" },
    { key: "availability", label: "Availability and notice period", done: !!profile.availabilityStatus, href: "/talent/profile#availability" },
    { key: "capabilities", label: "Core capabilities", done: caps > 0, href: "/talent/capabilities" },
    { key: "contribution", label: "At least one contribution or project", done: engs > 0, href: "/talent/portfolio/new" },
  ];
}

async function refreshCompletion(profileId: string, db: DbOrTx = getDb()) {
  const [profile] = await db.select().from(talentProfiles).where(eq(talentProfiles.id, profileId));
  if (!profile) return;
  const steps = await coreSteps(profile, db);
  const complete = steps.every((s) => s.done);
  if (complete && !profile.coreCompletedAt) await db.update(talentProfiles).set({ coreCompletedAt: new Date() }).where(eq(talentProfiles.id, profileId));
  if (!complete && profile.coreCompletedAt) await db.update(talentProfiles).set({ coreCompletedAt: null }).where(eq(talentProfiles.id, profileId));
}

/* ------------------------------------------------------------------ */
/* Search document                                                     */
/* ------------------------------------------------------------------ */

/**
 * Rebuilds the keyword search text from content visible to approved employers only.
 * A private profile has an empty search document, so private content can never be
 * matched or inferred through search. Values and motivations are never indexed.
 */
export async function refreshSearchText(profileId: string, db: DbOrTx = getDb()) {
  const [profile] = await db.select().from(talentProfiles).where(eq(talentProfiles.id, profileId));
  if (!profile) return;
  if (profile.visibility !== "approved_employers") {
    await db.update(talentProfiles).set({ searchText: "" }).where(eq(talentProfiles.id, profileId));
    return;
  }
  const [caps, engs, clms, narrative] = await Promise.all([
    db
      .select({ name: capabilities.name })
      .from(profileCapabilities)
      .innerJoin(capabilities, eq(capabilities.id, profileCapabilities.capabilityId))
      .where(and(eq(profileCapabilities.profileId, profileId), eq(profileCapabilities.visibility, "approved_employers"))),
    db.select().from(engagements).where(and(eq(engagements.profileId, profileId), eq(engagements.visibility, "approved_employers"))),
    db.select({ text: claims.text, engagementId: claims.engagementId }).from(claims).where(and(eq(claims.profileId, profileId), eq(claims.visibility, "approved_employers"))),
    db
      .select({ answer: moduleResponses.answer })
      .from(moduleResponses)
      .where(and(eq(moduleResponses.profileId, profileId), eq(moduleResponses.moduleKey, "narrative"), eq(moduleResponses.visibility, "approved_employers"))),
  ]);
  const visibleEngIds = new Set(engs.map((e) => e.id));
  const parts = [
    profile.fullName,
    profile.headline,
    profile.roleFamily ? labelOf(roleFamilies, profile.roleFamily) : null,
    profile.introduction,
    profile.locationCity,
    profile.locationCountry,
    profile.languages.join(" "),
    profile.sectors.join(" "),
    caps.map((c) => c.name).join(" "),
    ...engs.flatMap((e) => [
      e.title,
      e.confidentiality === "named" ? e.organisationName : e.anonymisedDescription,
      e.roleTitle,
      e.sector,
      e.country,
      e.context,
      e.individualActions,
      e.outcomes,
    ]),
    ...clms.filter((c) => !c.engagementId || visibleEngIds.has(c.engagementId)).map((c) => c.text),
    ...narrative.map((n) => n.answer),
  ];
  const searchText = parts.filter(Boolean).join("\n").slice(0, 60000);
  await db.update(talentProfiles).set({ searchText }).where(eq(talentProfiles.id, profileId));
}

/** Call after any change to a profile or its records. */
export async function profileChanged(profileId: string, db: DbOrTx = getDb()) {
  await db.update(talentProfiles).set({ updatedAt: new Date() }).where(eq(talentProfiles.id, profileId));
  await refreshCompletion(profileId, db);
  await refreshSearchText(profileId, db);
}

/* ------------------------------------------------------------------ */
/* Core sections (autosave)                                            */
/* ------------------------------------------------------------------ */

export async function saveProfileSection(actor: Actor, section: ProfileSectionKey, input: unknown) {
  const profileId = assertTalent(actor);
  const schema = profileSections[section];
  if (!schema) throw notFound();
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw validationError(fieldErrorsFrom(parsed.error));
  const db = getDb();
  await db
    .update(talentProfiles)
    .set({ ...(parsed.data as Partial<TalentProfileRow>), lastEditedSection: section })
    .where(eq(talentProfiles.id, profileId));
  await profileChanged(profileId);
  return { savedAt: new Date().toISOString() };
}

export async function confirmProfileCurrent(actor: Actor) {
  const profileId = assertTalent(actor);
  await getDb().update(talentProfiles).set({ lastConfirmedAt: new Date() }).where(eq(talentProfiles.id, profileId));
}

export async function updateVisibilitySettings(actor: Actor, input: unknown) {
  const profileId = assertTalent(actor);
  const parsed = visibilitySettingsSchema.safeParse(input);
  if (!parsed.success) throw validationError(fieldErrorsFrom(parsed.error));
  await getDb().update(talentProfiles).set(parsed.data).where(eq(talentProfiles.id, profileId));
  await profileChanged(profileId);
  await audit({ actorUserId: actor.userId, action: "profile.visibility_changed", targetType: "profile", targetId: profileId, metadata: { visibility: parsed.data.visibility } });
}

/* ------------------------------------------------------------------ */
/* Deeper modules                                                      */
/* ------------------------------------------------------------------ */

export async function saveModuleAnswer(actor: Actor, input: unknown) {
  const profileId = assertTalent(actor);
  const parsed = moduleAnswerSchema.safeParse(input);
  if (!parsed.success) throw validationError(fieldErrorsFrom(parsed.error));
  const { moduleKey, questionKey, answer, visibility } = parsed.data;
  const mod = moduleByKey(moduleKey);
  const question = mod?.questions.find((q) => q.key === questionKey);
  if (!mod || !question) throw notFound("That question");
  if (question.type === "scale" && answer && !/^[1-5]$/.test(answer)) throw validationError({ answer: "Choose a number from 1 to 5." });
  const db = getDb();
  if (!answer.trim()) {
    // An empty answer means "not provided": remove the row rather than storing a blank.
    await db.delete(moduleResponses).where(and(eq(moduleResponses.profileId, profileId), eq(moduleResponses.moduleKey, moduleKey), eq(moduleResponses.questionKey, questionKey)));
  } else {
    await db
      .insert(moduleResponses)
      .values({ profileId, moduleKey, questionKey, answer, visibility })
      .onConflictDoUpdate({
        target: [moduleResponses.profileId, moduleResponses.moduleKey, moduleResponses.questionKey],
        set: { answer, visibility, updatedAt: new Date() },
      });
  }
  await db.update(talentProfiles).set({ lastEditedSection: `module:${moduleKey}` }).where(eq(talentProfiles.id, profileId));
  await profileChanged(profileId);
  return { savedAt: new Date().toISOString() };
}

export async function moduleProgress(profileId: string) {
  const rows = await getDb()
    .select({ moduleKey: moduleResponses.moduleKey, n: count() })
    .from(moduleResponses)
    .where(eq(moduleResponses.profileId, profileId))
    .groupBy(moduleResponses.moduleKey);
  return Object.fromEntries(rows.map((r) => [r.moduleKey, r.n])) as Record<string, number>;
}

/* ------------------------------------------------------------------ */
/* Capabilities                                                        */
/* ------------------------------------------------------------------ */

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .slice(0, 80);

export async function findOrCreateCapability(name: string, category: (typeof capabilities.$inferInsert)["category"], db: DbOrTx = getDb()) {
  const slug = slugify(name);
  if (!slug) throw validationError({ name: "Enter a capability name." });
  const [existing] = await db.select().from(capabilities).where(eq(capabilities.slug, slug)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(capabilities).values({ name: name.trim(), slug, category }).onConflictDoNothing().returning();
  if (created) return created;
  const [again] = await db.select().from(capabilities).where(eq(capabilities.slug, slug)).limit(1);
  return again;
}

export async function listCapabilityTaxonomy(query = "") {
  const db = getDb();
  const where = query ? sql`${capabilities.name} ilike ${"%" + query + "%"}` : undefined;
  return db.select().from(capabilities).where(where).orderBy(capabilities.name).limit(400);
}

export async function upsertProfileCapability(actor: Actor, input: unknown) {
  const profileId = assertTalent(actor);
  const parsed = profileCapabilitySchema.safeParse(input);
  if (!parsed.success) throw validationError(fieldErrorsFrom(parsed.error));
  const { name, category, ...rest } = parsed.data;
  const db = getDb();
  const cap = await findOrCreateCapability(name, category, db);
  // Candidates set self-rated proficiency only; assessed proficiency is never writable here.
  await db
    .insert(profileCapabilities)
    .values({ profileId, capabilityId: cap.id, ...rest })
    .onConflictDoUpdate({ target: [profileCapabilities.profileId, profileCapabilities.capabilityId], set: rest });
  await profileChanged(profileId);
  return cap;
}

export async function removeProfileCapability(actor: Actor, profileCapabilityId: string) {
  const profileId = assertTalent(actor);
  const res = await getDb()
    .delete(profileCapabilities)
    .where(and(eq(profileCapabilities.id, profileCapabilityId), eq(profileCapabilities.profileId, profileId)))
    .returning({ id: profileCapabilities.id });
  if (!res.length) throw notFound("That capability");
  await profileChanged(profileId);
}

/* ------------------------------------------------------------------ */
/* Learning, public work and references (simple owned records)        */
/* ------------------------------------------------------------------ */

const ownedTables = {
  learning: { table: learningRecords, schema: learningRecordSchema },
  publicWork: { table: publicWorkItems, schema: publicWorkSchema },
  referee: { table: referees, schema: refereeSchema },
} as const;
export type OwnedRecordKind = keyof typeof ownedTables;

export async function saveOwnedRecord(actor: Actor, kind: OwnedRecordKind, input: unknown, recordId?: string | null) {
  const profileId = assertTalent(actor);
  const { table, schema } = ownedTables[kind];
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw validationError(fieldErrorsFrom(parsed.error));
  const db = getDb();
  let id: string;
  if (recordId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = table as any;
    const res = await db.update(t).set(parsed.data).where(and(eq(t.id, recordId), eq(t.profileId, profileId))).returning({ id: t.id });
    if (!res.length) throw notFound("That record");
    id = (res[0] as { id: string }).id;
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = table as any;
    const [row] = await db.insert(t).values({ ...parsed.data, profileId }).returning({ id: t.id });
    id = (row as { id: string }).id;
  }
  await profileChanged(profileId);
  return id;
}

export async function deleteOwnedRecord(actor: Actor, kind: OwnedRecordKind, recordId: string) {
  const profileId = assertTalent(actor);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = ownedTables[kind].table as any;
  const res = await getDb().delete(t).where(and(eq(t.id, recordId), eq(t.profileId, profileId))).returning({ id: t.id });
  if (!res.length) throw notFound("That record");
  await profileChanged(profileId);
}
