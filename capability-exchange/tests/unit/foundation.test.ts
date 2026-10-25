import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { parseEnv, ConfigError } from "@/config/env";
import { registerAccount, signIn } from "@/server/services/accounts";
import { createSession, userIdForSessionToken, destroySession } from "@/server/auth/sessions";
import { withOrgRls } from "@/server/db/client";
import { shortlists, applicationNotes, talentProfiles } from "@/server/db/schema";
import { createShortlist, listShortlists, getShortlist } from "@/server/services/applications";
import { setupTestDb } from "../helpers/db";
import { makeEmployer } from "../helpers/factories";

let ctx: Awaited<ReturnType<typeof setupTestDb>>;
beforeAll(async () => {
  ctx = await setupTestDb();
});
afterAll(async () => ctx.close());

describe("configuration (acceptance 13: production cannot enable demo sign-in)", () => {
  const prodBase = { NODE_ENV: "production", DATABASE_URL: "postgres://x", SESSION_SECRET: "x".repeat(40), APP_URL: "https://example.org" };

  it("refuses demo mode in production", () => {
    expect(() => parseEnv({ ...prodBase, APP_MODE: "demo" })).toThrow(ConfigError);
  });

  it("requires a database, a long session secret and https in production", () => {
    expect(() => parseEnv({ ...prodBase, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({ ...prodBase, SESSION_SECRET: "short" })).toThrow(/SESSION_SECRET/);
    expect(() => parseEnv({ ...prodBase, APP_URL: "http://example.org" })).toThrow(/https/);
  });

  it("never uses demonstration AI responses in production", () => {
    expect(parseEnv({ ...prodBase, AI_PROVIDER: "demo" }).aiProvider).toBe("none");
  });

  it("disables live AI when no API key is configured", () => {
    expect(parseEnv({ NODE_ENV: "development", AI_PROVIDER: "anthropic" }).aiProvider).toBe("none");
    expect(parseEnv({ NODE_ENV: "development", APP_MODE: "demo" }).aiProvider).toBe("demo");
    expect(parseEnv({ NODE_ENV: "development" }).aiProvider).toBe("none");
  });
});

describe("accounts and sessions (acceptance 1)", () => {
  it("registers a talent account with a private draft profile", async () => {
    const { userId } = await registerAccount({ displayName: "Ama Draft", email: "ama@example.test", password: "a long enough password", accountType: "talent" });
    const [profile] = await ctx.db.select().from(talentProfiles).where(sql`${talentProfiles.userId} = ${userId}`);
    expect(profile.visibility).toBe("private");
    expect(profile.coreCompletedAt).toBeNull();
  });

  it("rejects duplicate emails regardless of case", async () => {
    await expect(registerAccount({ displayName: "Dup", email: "AMA@example.test", password: "a long enough password", accountType: "talent" })).rejects.toThrow(/already exists/);
  });

  it("rejects short passwords with a field error", async () => {
    await expect(registerAccount({ displayName: "X", email: "x@example.test", password: "short", accountType: "talent" })).rejects.toMatchObject({ fieldErrors: { password: expect.any(String) } });
  });

  it("signs in with the right password and not the wrong one", async () => {
    await expect(signIn({ email: "ama@example.test", password: "a long enough password" })).resolves.toBeTypeOf("string");
    await expect(signIn({ email: "ama@example.test", password: "wrong password here" })).rejects.toThrow(/do not match/);
    await expect(signIn({ email: "nobody@example.test", password: "whatever password" })).rejects.toThrow(/do not match/);
  });

  it("rate-limits repeated failures", async () => {
    await registerAccount({ displayName: "Rate", email: "rate@example.test", password: "a long enough password", accountType: "talent" });
    for (let i = 0; i < 8; i++) await signIn({ email: "rate@example.test", password: "nope nope nope" }).catch(() => {});
    await expect(signIn({ email: "rate@example.test", password: "a long enough password" })).rejects.toThrow(/Too many/);
  });

  it("stores only a hash of the session token and resolves it until destroyed", async () => {
    const userId = await signIn({ email: "ama@example.test", password: "a long enough password" });
    const { token } = await createSession(userId);
    const stored = await ctx.db.execute(sql`select token_hash from sessions`);
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(await userIdForSessionToken(token)).toBe(userId);
    await destroySession(token);
    expect(await userIdForSessionToken(token)).toBeNull();
    expect(await userIdForSessionToken("not-a-real-token-at-all-123")).toBeNull();
  });
});

describe("row-level security on organisation-private tables (acceptance 8)", () => {
  it("lets each organisation see only its own shortlists, even without a WHERE clause", async () => {
    const a = await makeEmployer("Org A");
    const b = await makeEmployer("Org B");
    const listA = await createShortlist(a, { name: "A's private list" });
    await createShortlist(b, { name: "B's private list" });

    const rawForB = await withOrgRls(b.userId, (tx) => tx.select().from(shortlists));
    expect(rawForB.map((r) => r.name)).toEqual(["B's private list"]);

    expect((await listShortlists(b)).map((l) => l.name)).not.toContain("A's private list");
    await expect(getShortlist(b, listA)).rejects.toMatchObject({ code: "not_found" });
  });

  it("refuses to insert rows for another organisation", async () => {
    const a = await makeEmployer("Org C");
    const b = await makeEmployer("Org D");
    await expect(
      withOrgRls(b.userId, (tx) => tx.insert(shortlists).values({ organisationId: a.memberships[0].organisationId, name: "sneaky" })),
    ).rejects.toThrow();
  });

  it("gives the restricted role no access to other tables", async () => {
    const a = await makeEmployer("Org E");
    const error = await withOrgRls(a.userId, (tx) => tx.select().from(talentProfiles)).catch((e) => e);
    expect(String(error?.cause?.message ?? error)).toMatch(/permission denied/);
  });

  it("hides notes from members of pending organisations", async () => {
    const pending = await makeEmployer("Pending Org", "pending");
    const rows = await withOrgRls(pending.userId, (tx) => tx.select().from(applicationNotes));
    expect(rows).toEqual([]);
  });
});
