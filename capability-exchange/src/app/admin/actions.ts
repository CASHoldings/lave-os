"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/server/auth/current";
import { runAction, str } from "@/server/actions";
import { unauthenticated } from "@/server/errors";
import type { ActionState } from "@/lib/action-state";
import { formToObject } from "@/lib/validation";
import { recordVerificationReview, resolveReport, reviewOrganisation } from "@/server/services/admin";

async function actor() {
  const a = await getCurrentActor();
  if (!a) throw unauthenticated();
  return a;
}

export async function reviewOrganisationAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction("org_review", async () => {
    const decision = str(form, "decision") as "approved" | "rejected" | "suspended";
    await reviewOrganisation(await actor(), str(form, "organisationId"), decision, str(form, "reason"));
    revalidatePath("/admin", "layout");
    return { ok: true, message: `Organisation ${decision}. The decision and reason are in the audit record.` };
  });
}

export async function verificationReviewAction(_: ActionState, form: FormData): Promise<ActionState> {
  const result = await runAction("verification_review", async () => {
    await recordVerificationReview(await actor(), formToObject(form, ["evidenceIdsReviewed"]));
    revalidatePath("/admin", "layout");
  });
  if (result.ok) redirect("/admin/verification?reviewed=1");
  return result;
}

export async function resolveReportAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction("report_resolve", async () => {
    await resolveReport(await actor(), str(form, "reportId"), str(form, "outcome") === "actioned" ? "actioned" : "dismissed", str(form, "action") || "none", str(form, "reason"));
    revalidatePath("/admin", "layout");
    return { ok: true, message: "Report resolved and recorded." };
  });
}
