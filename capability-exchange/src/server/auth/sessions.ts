import { and, eq, gt, lt } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { sessions, users } from "@/server/db/schema";
import { randomToken, sha256 } from "@/server/crypto";

export const SESSION_COOKIE = "ace_session";
export const SESSION_DAYS = 14;

/** Creates a session and returns the raw token (only its hash is stored). */
export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  const db = getDb();
  await db.insert(sessions).values({ tokenHash: sha256(token), userId, expiresAt });
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
  // Opportunistic clean-up of expired sessions.
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  return { token, expiresAt };
}

export async function userIdForSessionToken(token: string | undefined | null): Promise<string | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const rows = await getDb()
    .select({ userId: sessions.userId, status: users.status })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  return row && row.status === "active" ? row.userId : null;
}

export async function destroySession(token: string | undefined | null) {
  if (!token) return;
  await getDb().delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
}

export async function destroyAllSessionsForUser(userId: string) {
  await getDb().delete(sessions).where(eq(sessions.userId, userId));
}
