"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button } from "./ui";

/**
 * Uploads a file to private storage through an authorised route. Uploading never verifies anything;
 * an attached claim moves at most to "Evidence supplied".
 */
export function EvidenceUploader({ claimId, accept }: { claimId?: string; accept: string }) {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const id = useId();
  const [state, setState] = useState<{ status: "idle" | "uploading" | "done" | "error"; message?: string; fieldErrors?: Record<string, string> }>({ status: "idle" });

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    if (claimId) data.set("claimId", claimId);
    setState({ status: "uploading" });
    try {
      const res = await fetch("/api/evidence/upload", { method: "POST", body: data });
      const body = (await res.json().catch(() => ({}))) as { message?: string; fieldErrors?: Record<string, string> };
      if (!res.ok) {
        setState({ status: "error", message: body.message ?? "The upload did not work. Please try again.", fieldErrors: body.fieldErrors });
        return;
      }
      ref.current?.reset();
      setState({ status: "done", message: "Uploaded to private storage." });
      router.refresh();
    } catch {
      setState({ status: "error", message: "The upload did not reach the server. Check your connection and try again." });
    }
  }

  const err = state.fieldErrors ?? {};
  return (
    <form ref={ref} onSubmit={onSubmit} className="space-y-3" aria-label="Upload evidence file">
      {state.message && <Alert tone={state.status === "error" ? "error" : "success"}>{state.message}</Alert>}
      <div>
        <label htmlFor={`${id}-file`} className="mb-1 block text-sm font-semibold">
          File <span className="text-danger">*</span>
        </label>
        <input id={`${id}-file`} name="file" type="file" required accept={accept} aria-describedby={`${id}-file-hint`} className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-surface-muted file:px-3 file:py-2 file:font-semibold" />
        <p id={`${id}-file-hint`} className="mt-1 text-xs text-ink-muted">PDF, image, Word, Excel or text, up to 10 MB. Redact anything you do not want to share before uploading.</p>
        {err.file && <p className="mt-1 text-sm font-semibold text-danger">{err.file}</p>}
      </div>
      <div>
        <label htmlFor={`${id}-title`} className="mb-1 block text-sm font-semibold">
          Title <span className="text-danger">*</span>
        </label>
        <input id={`${id}-title`} name="title" required className="block w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5" aria-invalid={!!err.title} />
        {err.title && <p className="mt-1 text-sm font-semibold text-danger">{err.title}</p>}
      </div>
      <div>
        <label htmlFor={`${id}-desc`} className="mb-1 block text-sm font-semibold">
          Description <span className="font-normal text-ink-soft">(optional)</span>
        </label>
        <input id={`${id}-desc`} name="description" className="block w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5" />
      </div>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" name="isRedacted" className="h-4 w-4 accent-[var(--color-accent)]" /> This is a redacted version
      </label>
      <fieldset>
        <legend className="mb-1 text-sm font-semibold">Who can open it</legend>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input type="radio" name="visibility" value="private" defaultChecked className="h-4 w-4 accent-[var(--color-accent)]" /> Only me (and platform reviewers if I request verification)
        </label>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input type="radio" name="visibility" value="approved_employers" className="h-4 w-4 accent-[var(--color-accent)]" /> Shareable, subject to my evidence setting
        </label>
      </fieldset>
      <Button type="submit" disabled={state.status === "uploading"} variant="secondary">
        {state.status === "uploading" ? "Uploading…" : "Upload file"}
      </Button>
    </form>
  );
}
