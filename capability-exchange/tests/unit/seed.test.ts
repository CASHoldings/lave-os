import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../helpers/db";
import { seedDemoData } from "@/server/seed/demo";
import { users, talentProfiles } from "@/server/db/schema";

let ctx: Awaited<ReturnType<typeof setupTestDb>>;
beforeAll(async () => {
  ctx = await setupTestDb();
});
afterAll(async () => ctx.close());

describe("fictional demonstration data", () => {
  it("loads, with demo accounts that cannot sign in with a password", async () => {
    const result = await seedDemoData();
    expect(result.verifiedClaims).toBe(1);
    const all = await ctx.db.select().from(users);
    expect(all.length).toBeGreaterThan(8);
    expect(all.every((u) => u.isDemo && u.passwordHash === null && u.email.endsWith("@demo.invalid"))).toBe(true);
    const privateProfile = await ctx.db.select().from(talentProfiles).where(eq(talentProfiles.fullName, "Samuel Tesfaye"));
    expect(privateProfile[0].visibility).toBe("private");
    expect(privateProfile[0].searchText).toBe("");
  });
});
