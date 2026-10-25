"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/server/auth/current";
import { runAction, str } from "@/server/actions";
import { unauthenticated } from "@/server/errors";
import type { ActionState } from "@/lib/action-state";
import { formToObject } from "@/lib/validation";
import { primaryMembership } from "@/server/policy/actor";
import {
  addMember,
  addRequirement,
  registerOrganisation,
  removeMember,
  removeRequirement,
  saveOpportunity,
  setOpportunityStatus,
  updateOrganisation,
} from "@/server/services/employer";
import {
  addApplicationNote,
  addToShortlist,
  createShortlist,
  deleteShortlist,
  removeFromShortlist,
  requestIntroduction,
  setApplicationStatus,
  updateShortlistNote,
} from "@/server/services/applications";

async function actor() {
  const a = await getCurrentActor();
  if (!a) throw unauthenticated();
  return a;
}

export async function registerOrganisationAction(_: ActionState, form: FormData): Promise<ActionState> {
  const result = await runAction("org_register", async () => {
    await registerOrganisation(await actor(), formToObject(form));
  });
  if (result.ok) redirect("/employer?registered=1");
  return result;
}

export async function updateOrganisationAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction("org_update", async () => {
    const a = await actor();
    const m = primaryMembership(a);
    if (!m) throw unauthenticated();
    await updateOrganisation(a, m.organisationId, formToObject(form));
    revalidatePath("/employer", "layout");
    return { ok: true, message: "Organisation details saved." };
  });
}

export async function addMemberAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction("member_add", async () => {
    const a = await actor();
    const m = primaryMembership(a);
    if (!m) throw unauthenticated();
    await addMember(a, m.organisationId, str(form, "email"), str(form, "role") === "admin" ? "admin" : "member");
    revalidatePath("/employer/team");
    return { ok: true, message: "Colleague added." };
  });
}

export async function removeMemberAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction("member_remove", async () => {
    const a = await actor();
    const m = primaryMembership(a);
    if (!m) throw unauthenticated();
    await removeMember(a, m.organisationId, str(form, "membershipId"));
    revalidatePath("/employer/team");
    return { ok: true, message: "Removed." };
  });
}

export async function saveOpportunityAction(_: ActionState, form: FormData): Promise<ActionState> {
  let id = "";
  const result = await runAction("opportunity_save", async () => {
    id = await saveOpportunity(await actor(), formToObject(form, ["sectors"]), str(form, "opportunityId") || null);
    revalidatePath("/employer", "layout");
  });
  if (result.ok) redirect(`/employer/opportunities/${id}?saved=1`);
  return result;
}

export async function opportunityStatusAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction("opportunity_status", async () => {
    const status = str(form, "status") as "draft" | "published" | "closed";
    await setOpportunityStatus(await actor(), str(form, "opportunityId"), status);
    revalidatePath("/employer", "layout");
    return { ok: true, message: status === "published" ? "Published. Professionals can now find and apply." : status === "closed" ? "Closed to new applications." : "Moved back to draft." };
  });
}

export async function addRequirementAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction("requirement_add", async () => {
    await addRequirement(await actor(), str(form, "opportunityId"), formToObject(form));
    revalidatePath("/employer", "layout");
    return { ok: true, message: "Requirement added." };
  });
}

export async function removeRequirementAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction("requirement_remove", async () => {
    await removeRequirement(await actor(), str(form, "opportunityId"), str(form, "requirementId"));
    revalidatePath("/employer", "layout");
    return { ok: true, message: "Removed." };
  });
}

export async function applicationStatusAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction("application_status", async () => {
    await setApplicationStatus(await actor(), str(form, "applicationId"), str(form, "status"), str(form, "note") || null);
    revalidatePath("/employer", "layout");
    return { ok: true, message: "Status updated and recorded." };
  });
}

export async function addNoteAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction("note_add", async () => {
    await addApplicationNote(await actor(), str(form, "applicationId"), str(form, "body"));
    revalidatePath("/employer", "layout");
    return { ok: true, message: "Note saved. Only your organisation can see it." };
  });
}

export async function requestIntroductionAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction("intro_request", async () => {
    await requestIntroduction(await actor(), formToObject(form));
    revalidatePath("/employer", "layout");
    return { ok: true, message: "Request sent. Contact details are shared only if the candidate accepts." };
  });
}

export async function createShortlistAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction("shortlist_create", async () => {
    await createShortlist(await actor(), formToObject(form));
    revalidatePath("/employer", "layout");
    return { ok: true, message: "Shortlist created." };
  });
}

export async function addToShortlistAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction("shortlist_add", async () => {
    await addToShortlist(await actor(), str(form, "shortlistId"), str(form, "profileId"), str(form, "note") || null);
    revalidatePath("/employer", "layout");
    return { ok: true, message: "Added to shortlist." };
  });
}

export async function removeFromShortlistAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction("shortlist_remove", async () => {
    await removeFromShortlist(await actor(), str(form, "entryId"));
    revalidatePath("/employer", "layout");
    return { ok: true, message: "Removed from shortlist." };
  });
}

export async function shortlistNoteAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction("shortlist_note", async () => {
    await updateShortlistNote(await actor(), str(form, "entryId"), str(form, "note"));
    revalidatePath("/employer", "layout");
    return { ok: true, message: "Note saved." };
  });
}

export async function deleteShortlistAction(_: ActionState, form: FormData): Promise<ActionState> {
  const result = await runAction("shortlist_delete", async () => {
    await deleteShortlist(await actor(), str(form, "shortlistId"));
    revalidatePath("/employer", "layout");
  });
  if (result.ok) redirect("/employer/shortlists");
  return result;
}
