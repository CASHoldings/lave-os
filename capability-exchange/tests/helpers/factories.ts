import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { organisationMemberships, organisations, users } from "@/server/db/schema";
import { registerAccount } from "@/server/services/accounts";
import { loadActor, type Actor } from "@/server/policy/actor";
import { saveProfileSection, upsertProfileCapability, updateVisibilitySettings } from "@/server/services/profile";
import { saveEngagement } from "@/server/services/portfolio";

let n = 0;
const uniq = () => `${Date.now().toString(36)}${(n++).toString(36)}`;

export async function makeTalent(name = "Test Talent"): Promise<Actor> {
  const { userId } = await registerAccount({ displayName: name, email: `talent-${uniq()}@example.test`, password: "correct horse battery", accountType: "talent" });
  return (await loadActor(userId))!;
}

/** A talent with a complete core profile, optionally visible to approved employers. */
export async function makeCompleteTalent(name = "Complete Talent", opts: { visible?: boolean } = {}): Promise<Actor> {
  const actor = await makeTalent(name);
  await saveProfileSection(actor, "basics", { fullName: name, headline: "Infrastructure finance lead", roleFamily: "investment", yearsExperience: "12" });
  await saveProfileSection(actor, "location", { locationCity: "Accra", locationCountry: "Ghana", timeZone: "GMT", languages: ["English", "French"] });
  await saveProfileSection(actor, "introduction", { introduction: "I structure and close infrastructure financings for ports and energy assets across West Africa, from mandate to financial close.", sectors: ["Energy and renewables"] });
  await saveProfileSection(actor, "preferences", { opportunityTypes: ["permanent", "advisory"], workArrangements: ["remote", "hybrid"], relocation: "open" });
  await saveProfileSection(actor, "availability", { availabilityStatus: "available_now", noticePeriodWeeks: "4" });
  await upsertProfileCapability(actor, { name: "Project finance", category: "domain", tier: "core", selfProficiency: "expert" });
  await saveEngagement(actor, { kind: "project", title: "Port terminal refinancing", organisationName: "Fictional Ports Ltd", status: "completed", outcomes: "Closed refinancing." });
  if (opts.visible) await updateVisibilitySettings(actor, { visibility: "approved_employers", contactVisibility: "on_introduction", evidenceVisibility: "approved_employers" });
  return (await loadActor(actor.userId))!;
}

export async function makeEmployer(orgName = "Test Org", status: "pending" | "approved" = "approved"): Promise<Actor> {
  const { userId } = await registerAccount({ displayName: `${orgName} Recruiter`, email: `employer-${uniq()}@example.test`, password: "correct horse battery", accountType: "employer" });
  const db = getDb();
  const [org] = await db.insert(organisations).values({ name: orgName, status }).returning();
  await db.insert(organisationMemberships).values({ organisationId: org.id, userId, role: "owner" });
  return (await loadActor(userId))!;
}

export async function makeAdmin(): Promise<Actor> {
  const { userId } = await registerAccount({ displayName: "Admin", email: `admin-${uniq()}@example.test`, password: "correct horse battery", accountType: "employer" });
  await getDb().update(users).set({ platformRole: "admin" }).where(eq(users.id, userId));
  return (await loadActor(userId))!;
}

export const reload = async (a: Actor) => (await loadActor(a.userId))!;
