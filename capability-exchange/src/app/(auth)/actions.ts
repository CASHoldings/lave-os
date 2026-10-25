"use server";

import { redirect } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { registerAccount, signIn } from "@/server/services/accounts";
import { endSession, startSession } from "@/server/auth/current";
import { runAction, str } from "@/server/actions";
import type { ActionState } from "@/lib/action-state";
import { isDemoMode } from "@/config/env";
import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { loadActor } from "@/server/policy/actor";
import { notFound } from "@/server/errors";

/** Only same-site relative paths are accepted as a post-sign-in destination. */
function safeNext(next: string): string | null {
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : null;
}

async function homeFor(userId: string) {
  const actor = await loadActor(userId);
  if (!actor) return "/";
  if (actor.profileId) return "/talent";
  if (actor.memberships.length) return "/employer";
  if (actor.isAdmin) return "/admin";
  return "/employer/onboarding";
}

export async function registerAction(_: ActionState, form: FormData): Promise<ActionState> {
  let destination = "/";
  const result = await runAction("register", async () => {
    const { userId, needsEmailConfirmation } = await registerAccount({
      displayName: str(form, "displayName"),
      email: str(form, "email"),
      password: str(form, "password"),
      accountType: str(form, "accountType"),
    });
    if (needsEmailConfirmation) return { ok: true, message: "Check your email to confirm your address, then sign in." };
    await startSession(userId);
    destination = str(form, "accountType") === "talent" ? "/talent/profile?welcome=1" : "/employer/onboarding";
  });
  if (result.ok && !result.message) redirect(destination);
  return result;
}

export async function signInAction(_: ActionState, form: FormData): Promise<ActionState> {
  let destination = "/";
  const result = await runAction("sign_in", async () => {
    const userId = await signIn({ email: str(form, "email"), password: str(form, "password") });
    await startSession(userId);
    destination = safeNext(str(form, "next")) ?? (await homeFor(userId));
  });
  if (result.ok) redirect(destination);
  return result;
}

export async function signOutAction() {
  await endSession();
  redirect("/");
}

/** One-click sign-in as a fictional persona. Refused unless the app is in local demo mode. */
export async function demoSignInAction(_: ActionState, form: FormData): Promise<ActionState> {
  let destination = "/";
  const result = await runAction("demo_sign_in", async () => {
    if (!isDemoMode()) throw notFound();
    const [user] = await getDb()
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, str(form, "userId")), eq(users.isDemo, true), eq(users.authProvider, "demo")))
      .limit(1);
    if (!user) throw notFound("That demo account");
    await startSession(user.id);
    destination = await homeFor(user.id);
  });
  if (result.ok) redirect(destination);
  return result;
}
