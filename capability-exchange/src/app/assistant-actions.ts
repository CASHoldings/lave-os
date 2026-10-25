"use server";

import { revalidatePath } from "next/cache";
import { getCurrentActor } from "@/server/auth/current";
import { runAction, str } from "@/server/actions";
import { unauthenticated } from "@/server/errors";
import type { ActionState } from "@/lib/action-state";
import {
  approveSuggestion,
  clarifyOpportunity,
  explainComparison,
  extractFromText,
  followUpQuestions,
  rejectSuggestion,
  suggestRewrite,
  summariseProfile,
} from "@/server/services/assistant";

async function actor() {
  const a = await getCurrentActor();
  if (!a) throw unauthenticated();
  return a;
}

const done = (message: string): ActionState => ({ ok: true, message });

export async function summariseAction(): Promise<ActionState> {
  return runAction("ai_summary", async () => {
    await summariseProfile(await actor());
    revalidatePath("/talent/assistant");
    return done("Summary ready below.");
  });
}

export async function rewriteAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction("ai_rewrite", async () => {
    await suggestRewrite(await actor(), str(form, "target"));
    revalidatePath("/talent/assistant");
    return done("Suggestion ready below. Nothing changes until you approve it.");
  });
}

export async function extractAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction("ai_extract", async () => {
    await extractFromText(await actor(), str(form, "text"));
    revalidatePath("/talent/assistant");
    return done("Draft records ready below. Choose which to add.");
  });
}

export async function followUpAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction("ai_follow_up", async () => {
    await followUpQuestions(await actor(), str(form, "engagementId"));
    revalidatePath("/talent/assistant");
    return done("Questions ready below.");
  });
}

export async function approveSuggestionAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction("ai_approve", async () => {
    const levels: Record<string, string> = {};
    for (const [k, v] of form.entries()) if (k.startsWith("level:") && typeof v === "string" && v) levels[k.slice(6)] = v;
    const n = await approveSuggestion(await actor(), str(form, "suggestionId"), {
      items: form.getAll("items").map(String),
      levels,
      editedText: form.has("editedText") ? str(form, "editedText") : null,
    });
    revalidatePath("/talent", "layout");
    return done(n ? `Approved. ${n} change${n === 1 ? "" : "s"} saved to your profile.` : "Marked as reviewed.");
  });
}

export async function rejectSuggestionAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction("ai_reject", async () => {
    await rejectSuggestion(await actor(), str(form, "suggestionId"));
    revalidatePath("/talent", "layout");
    revalidatePath("/employer", "layout");
    return done("Dismissed. Nothing was changed.");
  });
}

export async function explainComparisonAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction("ai_compare", async () => {
    await explainComparison(await actor(), str(form, "profileId"), str(form, "opportunityId"));
    revalidatePath("/employer", "layout");
    return done("Explanation ready.");
  });
}

export async function clarifyOpportunityAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction("ai_clarify", async () => {
    await clarifyOpportunity(await actor(), str(form, "opportunityId"));
    revalidatePath("/employer", "layout");
    return done("Review ready below.");
  });
}
