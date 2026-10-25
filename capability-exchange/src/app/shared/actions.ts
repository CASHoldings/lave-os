"use server";

import { getCurrentActor } from "@/server/auth/current";
import { runAction } from "@/server/actions";
import { createReport } from "@/server/services/admin";
import { formToObject } from "@/lib/validation";
import { unauthenticated } from "@/server/errors";
import type { ActionState } from "@/lib/action-state";

export async function reportAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction("report", async () => {
    const actor = await getCurrentActor();
    if (!actor) throw unauthenticated();
    await createReport(actor, formToObject(form));
    return { ok: true, message: "Thank you. An administrator will review this report." };
  });
}
