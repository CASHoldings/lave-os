"use server";

import { redirect } from "next/navigation";
import { getCurrentActor, endSession } from "@/server/auth/current";
import { runAction, str } from "@/server/actions";
import { deleteAccount } from "@/server/services/account-data";
import { unauthenticated } from "@/server/errors";
import type { ActionState } from "@/lib/action-state";

export async function deleteAccountAction(_: ActionState, form: FormData): Promise<ActionState> {
  const result = await runAction("delete_account", async () => {
    const actor = await getCurrentActor();
    if (!actor) throw unauthenticated();
    await deleteAccount(actor, str(form, "confirmation"));
    await endSession();
  });
  if (result.ok) redirect("/?deleted=1");
  return result;
}
