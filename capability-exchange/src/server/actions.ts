import "server-only";
import { unstable_rethrow } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { isAppError } from "./errors";
import { logError } from "./log";

/**
 * Runs a server action body and turns failures into a message for the form.
 * Redirects and not-found signals from Next.js pass through untouched.
 */
export async function runAction(name: string, fn: () => Promise<ActionState | void>): Promise<ActionState> {
  try {
    return (await fn()) ?? { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    if (isAppError(error)) return { ok: false, message: error.message, fieldErrors: error.fieldErrors };
    logError(`action.${name}.failed`, error);
    return { ok: false, message: "Something went wrong and your change was not saved. Please try again." };
  }
}

export const str = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
};
