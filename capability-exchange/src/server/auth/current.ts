import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getEnv } from "@/config/env";
import { loadActor, canDiscoverTalent, type Actor } from "@/server/policy/actor";
import { createSession, destroySession, SESSION_COOKIE, userIdForSessionToken } from "./sessions";

/** The signed-in person for this request, or null. Cached per request. */
export const getCurrentActor = cache(async (): Promise<Actor | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const userId = await userIdForSessionToken(token);
  return userId ? loadActor(userId) : null;
});

export async function startSession(userId: string) {
  const { token, expiresAt } = await createSession(userId);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: getEnv().NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function endSession() {
  const store = await cookies();
  await destroySession(store.get(SESSION_COOKIE)?.value);
  store.delete(SESSION_COOKIE);
}

/* Page guards: redirect people to the right place rather than showing an error. */

export async function requireActor(next?: string): Promise<Actor> {
  const actor = await getCurrentActor();
  if (!actor) redirect(next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in");
  return actor;
}

export async function requireTalent(): Promise<Actor & { profileId: string }> {
  const actor = await requireActor("/talent");
  if (!actor.profileId) redirect(actor.memberships.length || actor.accountType === "employer" ? "/employer" : "/");
  return actor as Actor & { profileId: string };
}

export async function requireEmployer(): Promise<Actor> {
  const actor = await requireActor("/employer");
  if (!actor.memberships.length) redirect("/employer/onboarding");
  return actor;
}

export async function requireDiscoveryAccess(): Promise<Actor> {
  const actor = await requireEmployer();
  if (!canDiscoverTalent(actor)) redirect("/employer?pending=1");
  return actor;
}

export async function requireAdmin(): Promise<Actor> {
  const actor = await requireActor("/admin");
  if (!actor.isAdmin) redirect("/");
  return actor;
}
