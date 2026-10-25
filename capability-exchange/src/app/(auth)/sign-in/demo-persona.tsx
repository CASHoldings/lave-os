"use client";

import { useActionState, type ReactNode } from "react";
import type { ActionState } from "@/lib/action-state";

export function DemoPersonaButton({ action, userId, children }: { action: (s: ActionState, f: FormData) => Promise<ActionState>; userId: string; children: ReactNode }) {
  const [state, formAction, pending] = useActionState(action, { ok: false } as ActionState);
  return (
    <form action={formAction}>
      <input type="hidden" name="userId" value={userId} />
      <button type="submit" disabled={pending} className="block min-h-11 w-full rounded-lg border border-line bg-surface px-4 py-3 text-left hover:border-accent disabled:opacity-60">
        {children}
      </button>
      {state.message && <p role="alert" className="mt-1 text-sm text-danger">{state.message}</p>}
    </form>
  );
}
