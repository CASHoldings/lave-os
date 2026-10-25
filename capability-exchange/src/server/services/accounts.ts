import { and, count, eq, gt, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { authAttempts, talentProfiles, users } from "@/server/db/schema";
import { registerSchema, signInSchema, fieldErrorsFrom } from "@/lib/validation";
import { conflict, rateLimited, validationError, AppError } from "@/server/errors";
import { sha256 } from "@/server/crypto";
import { getIdentityProvider, type IdentityProvider } from "@/server/auth/identity";
import { audit } from "./audit";

const WINDOW_MINUTES = 15;
const MAX_FAILURES = 8;

export async function registerAccount(input: unknown, identity: IdentityProvider = getIdentityProvider()) {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) throw validationError(fieldErrorsFrom(parsed.error));
  const { email, password, displayName, accountType } = parsed.data;
  const db = getDb();

  const existing = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
  if (existing.length) throw conflict("An account with that email already exists. Try signing in instead.");

  const registered = await identity.register({ email, password });
  const userId = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ email, displayName, accountType, passwordHash: registered.passwordHash, authProvider: identity.name, externalAuthId: registered.externalId })
      .returning({ id: users.id });
    if (accountType === "talent") {
      await tx.insert(talentProfiles).values({ userId: user.id, fullName: displayName });
    }
    await audit({ actorUserId: user.id, action: "account.registered", targetType: "user", targetId: user.id, metadata: { kind: accountType } }, tx);
    return user.id;
  });
  return { userId, needsEmailConfirmation: registered.needsEmailConfirmation };
}

export async function signIn(input: unknown, identity: IdentityProvider = getIdentityProvider()): Promise<string> {
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) throw validationError(fieldErrorsFrom(parsed.error));
  const { email, password } = parsed.data;
  const db = getDb();
  const keyHash = sha256(`signin:${email}`);

  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000);
  const [{ failures }] = await db
    .select({ failures: count() })
    .from(authAttempts)
    .where(and(eq(authAttempts.keyHash, keyHash), eq(authAttempts.succeeded, false), gt(authAttempts.createdAt, since)));
  if (failures >= MAX_FAILURES) throw rateLimited(`Too many unsuccessful attempts. Please wait ${WINDOW_MINUTES} minutes and try again.`);

  const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
  const generic = new AppError("That email and password do not match an account.", "unauthenticated");

  let ok = false;
  if (user && user.status === "active" && user.authProvider === identity.name) {
    const result = await identity.verify({ email, password, passwordHash: user.passwordHash });
    ok = result.ok && (identity.name !== "supabase" || result.externalId === user.externalAuthId);
  }
  await db.insert(authAttempts).values({ keyHash, succeeded: ok });
  if (!ok || !user) throw generic;
  return user.id;
}
