"use client";

import { useActionState, useId } from "react";
import type { ActionState } from "@/lib/action-state";
import { Alert, Button } from "@/components/ui";
import { FormErrorsProvider, Checkbox, TextField, SelectField } from "@/components/forms";

export function ShareLinkForm({ action, origin }: { action: (s: ActionState, f: FormData) => Promise<ActionState>; origin: string }) {
  const [state, formAction, pending] = useActionState(action, { ok: false } as ActionState);
  const id = useId();
  const url = state.data?.token ? `${origin}/share/${state.data.token}` : null;
  return (
    <FormErrorsProvider errors={state.fieldErrors ?? {}}>
      <form action={formAction} className="space-y-4" aria-label="Create a share link">
        {state.message && <Alert tone={state.ok ? "success" : "error"}>{state.message}</Alert>}
        {url && (
          <div>
            <label htmlFor={id} className="mb-1 block text-sm font-semibold">
              Your new link
            </label>
            <input id={id} readOnly value={url} className="block w-full rounded-lg border border-accent bg-accent-soft px-3 py-2.5 font-mono text-sm" onFocus={(e) => e.currentTarget.select()} />
          </div>
        )}
        <TextField name="label" label="Who is it for?" required hint="A private label so you remember, e.g. “Recruiter at a conference”." />
        <SelectField
          name="expiresInDays"
          label="Expires after"
          required
          defaultValue="14"
          options={[
            { value: "1", label: "1 day" },
            { value: "7", label: "7 days" },
            { value: "14", label: "14 days" },
            { value: "30", label: "30 days" },
            { value: "90", label: "90 days" },
          ]}
        />
        <Checkbox name="includeContact" label="Include my email and phone" />
        <Checkbox name="includeEvidence" label="Include evidence I have marked shareable" />
        <p className="text-sm text-ink-muted">Private items, private notes and reference contact details are never included.</p>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create link"}
        </Button>
      </form>
    </FormErrorsProvider>
  );
}
