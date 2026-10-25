"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/server/auth/current";
import { runAction, str } from "@/server/actions";
import { unauthenticated } from "@/server/errors";
import type { ActionState } from "@/lib/action-state";
import { formToObject, profileSectionKeys, type ProfileSectionKey } from "@/lib/validation";
import {
  confirmProfileCurrent,
  deleteOwnedRecord,
  removeProfileCapability,
  saveModuleAnswer,
  saveOwnedRecord,
  saveProfileSection,
  updateVisibilitySettings,
  upsertProfileCapability,
  type OwnedRecordKind,
} from "@/server/services/profile";
import {
  addEvidenceLink,
  attachEvidence,
  confirmClaim,
  deleteClaim,
  deleteEngagement,
  deleteEvidence,
  detachEvidence,
  requestVerification,
  saveClaim,
  saveEngagement,
  updateEvidenceVisibility,
} from "@/server/services/portfolio";
import { createShareLink, respondToIntroduction, revokeGrant, revokeShareLink } from "@/server/services/sharing";
import { applyToOpportunity, withdrawApplication } from "@/server/services/applications";

async function actor() {
  const a = await getCurrentActor();
  if (!a) throw unauthenticated();
  return a;
}

/* Profile sections: called directly by the autosave form. */
export async function saveSectionAction(section: string, form: FormData): Promise<ActionState & { savedAt?: string }> {
  return runAction("save_section", async () => {
    if (!profileSectionKeys.includes(section as ProfileSectionKey)) throw unauthenticated();
    const res = await saveProfileSection(await actor(), section as ProfileSectionKey, formToObject(form, ["languages", "sectors", "opportunityTypes", "workArrangements"]));
    revalidatePath("/talent", "layout");
    return { ok: true, data: { savedAt: res.savedAt } };
  });
}

export async function saveModuleAnswerAction(form: FormData): Promise<ActionState> {
  return runAction("save_module", async () => {
    const res = await saveModuleAnswer(await actor(), {
      moduleKey: str(form, "moduleKey"),
      questionKey: str(form, "questionKey"),
      answer: str(form, "answer"),
      visibility: str(form, "visibility") || "approved_employers",
    });
    return { ok: true, data: { savedAt: res.savedAt } };
  });
}

export async function updateVisibilityAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction("visibility", async () => {
    await updateVisibilitySettings(await actor(), formToObject(form));
    revalidatePath("/talent", "layout");
    return { ok: true, message: "Sharing settings saved." };
  });
}

export async function confirmProfileAction(): Promise<ActionState> {
  return runAction("confirm_profile", async () => {
    await confirmProfileCurrent(await actor());
    revalidatePath("/talent");
    return { ok: true, message: "Thanks. Your profile is marked as up to date." };
  });
}

/* Capabilities */
export async function saveCapabilityAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction("capability", async () => {
    await upsertProfileCapability(await actor(), formToObject(form));
    revalidatePath("/talent/capabilities");
    return { ok: true, message: "Capability saved." };
  });
}

export async function removeCapabilityAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction("capability_remove", async () => {
    await removeProfileCapability(await actor(), str(form, "id"));
    revalidatePath("/talent/capabilities");
    return { ok: true, message: "Removed." };
  });
}

/* Simple records: learning, public work, references */
export async function saveRecordAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction("record", async () => {
    const kind = str(form, "recordKind") as OwnedRecordKind;
    await saveOwnedRecord(await actor(), kind, formToObject(form), str(form, "recordId") || null);
    revalidatePath("/talent", "layout");
    return { ok: true, message: "Saved." };
  });
}

export async function deleteRecordAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction("record_delete", async () => {
    await deleteOwnedRecord(await actor(), str(form, "recordKind") as OwnedRecordKind, str(form, "recordId"));
    revalidatePath("/talent", "layout");
    return { ok: true, message: "Deleted." };
  });
}

/* Engagements, claims and evidence */
export async function saveEngagementAction(_: ActionState, form: FormData): Promise<ActionState> {
  let id = "";
  const result = await runAction("engagement", async () => {
    id = await saveEngagement(await actor(), formToObject(form, ["capabilityIds"]), str(form, "engagementId") || null);
    revalidatePath("/talent", "layout");
  });
  if (result.ok) redirect(`/talent/portfolio/${id}?saved=1`);
  return result;
}

export async function deleteEngagementAction(_: ActionState, form: FormData): Promise<ActionState> {
  const result = await runAction("engagement_delete", async () => {
    await deleteEngagement(await actor(), str(form, "engagementId"));
    revalidatePath("/talent", "layout");
  });
  if (result.ok) redirect("/talent/portfolio?deleted=1");
  return result;
}

export async function saveClaimAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction("claim", async () => {
    await saveClaim(await actor(), formToObject(form), str(form, "claimId") || null);
    revalidatePath("/talent", "layout");
    return { ok: true, message: "Claim saved." };
  });
}

export async function deleteClaimAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction("claim_delete", async () => {
    await deleteClaim(await actor(), str(form, "claimId"));
    revalidatePath("/talent", "layout");
    return { ok: true, message: "Claim deleted." };
  });
}

export async function confirmClaimAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction("claim_confirm", async () => {
    await confirmClaim(await actor(), str(form, "claimId"));
    revalidatePath("/talent", "layout");
    return { ok: true, message: "Confirmed as current." };
  });
}

export async function requestVerificationAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction("verification_request", async () => {
    await requestVerification(await actor(), str(form, "claimId"));
    revalidatePath("/talent", "layout");
    return { ok: true, message: "Verification requested. A reviewer will record what they check." };
  });
}

export async function addEvidenceLinkAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction("evidence_link", async () => {
    await addEvidenceLink(await actor(), formToObject(form), str(form, "claimId") || null);
    revalidatePath("/talent", "layout");
    return { ok: true, message: "Link added." };
  });
}

export async function attachEvidenceAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction("evidence_attach", async () => {
    await attachEvidence(await actor(), str(form, "claimId"), str(form, "evidenceId"));
    revalidatePath("/talent", "layout");
    return { ok: true, message: "Evidence attached." };
  });
}

export async function detachEvidenceAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction("evidence_detach", async () => {
    await detachEvidence(await actor(), str(form, "claimId"), str(form, "evidenceId"));
    revalidatePath("/talent", "layout");
    return { ok: true, message: "Detached." };
  });
}

export async function deleteEvidenceAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction("evidence_delete", async () => {
    await deleteEvidence(await actor(), str(form, "evidenceId"));
    revalidatePath("/talent", "layout");
    return { ok: true, message: "Evidence and its file deleted." };
  });
}

export async function evidenceVisibilityAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction("evidence_visibility", async () => {
    await updateEvidenceVisibility(await actor(), str(form, "evidenceId"), str(form, "visibility") === "approved_employers" ? "approved_employers" : "private");
    revalidatePath("/talent", "layout");
    return { ok: true, message: "Updated." };
  });
}

/* Sharing */
export async function createShareLinkAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction("share_create", async () => {
    const link = await createShareLink(await actor(), formToObject(form));
    revalidatePath("/talent/sharing");
    return { ok: true, message: "Link created. Copy it now: for your security it is only shown once.", data: { token: link.token } };
  });
}

export async function revokeShareLinkAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction("share_revoke", async () => {
    await revokeShareLink(await actor(), str(form, "linkId"));
    revalidatePath("/talent/sharing");
    return { ok: true, message: "Link revoked. It no longer works." };
  });
}

export async function revokeGrantAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction("grant_revoke", async () => {
    await revokeGrant(await actor(), str(form, "grantId"));
    revalidatePath("/talent/sharing");
    return { ok: true, message: "Permission withdrawn." };
  });
}

export async function respondIntroductionAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction("intro_respond", async () => {
    const accept = str(form, "decision") === "accept";
    await respondToIntroduction(await actor(), str(form, "requestId"), accept);
    revalidatePath("/talent", "layout");
    return { ok: true, message: accept ? "Accepted. Your contact details are now visible to that organisation." : "Declined. Nothing was shared." };
  });
}

/* Applications */
export async function applyAction(_: ActionState, form: FormData): Promise<ActionState> {
  let id = "";
  const result = await runAction("apply", async () => {
    id = await applyToOpportunity(await actor(), formToObject(form));
    revalidatePath("/talent", "layout");
  });
  if (result.ok) redirect(`/talent/applications/${id}?submitted=1`);
  return result;
}

export async function withdrawApplicationAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction("withdraw", async () => {
    await withdrawApplication(await actor(), str(form, "applicationId"));
    revalidatePath("/talent", "layout");
    return { ok: true, message: "Application withdrawn. The organisation can no longer see the profile you shared." };
  });
}
