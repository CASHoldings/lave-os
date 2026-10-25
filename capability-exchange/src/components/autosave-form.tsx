"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { FormErrorsProvider } from "./forms";
import { Button, cx } from "./ui";
import type { ActionState } from "@/lib/action-state";

type Status = "idle" | "pending" | "saving" | "saved" | "error";

/**
 * Saves a section automatically a moment after the person stops typing, and when they
 * press Save. Status is announced to screen readers. Drafts can be incomplete:
 * only fields that fail validation are reported, and nothing else is lost.
 */
export function AutosaveForm({
  save,
  children,
  label,
  className,
  delay = 1200,
}: {
  save: (form: FormData) => Promise<ActionState>;
  children: ReactNode;
  label: string;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const run = () => {
    if (timer.current) clearTimeout(timer.current);
    if (!ref.current) return;
    const data = new FormData(ref.current);
    setStatus("saving");
    startTransition(async () => {
      const result = await save(data);
      if (result.ok) {
        setErrors({});
        setMessage(null);
        setSavedAt(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
        setStatus("saved");
      } else {
        setErrors(result.fieldErrors ?? {});
        setMessage(result.message ?? "This section could not be saved.");
        setStatus("error");
      }
    });
  };

  const schedule = () => {
    setStatus("pending");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(run, delay);
  };

  return (
    <FormErrorsProvider errors={errors}>
      <form
        ref={ref}
        aria-label={label}
        className={cx("space-y-5", className)}
        noValidate
        onChange={schedule}
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        {children}
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <Button type="submit" variant="secondary" disabled={status === "saving"}>
            {status === "saving" ? "Saving…" : "Save"}
          </Button>
          <p aria-live="polite" className={cx("text-sm", status === "error" ? "font-semibold text-danger" : "text-ink-muted")}>
            {status === "pending" && "Unsaved changes…"}
            {status === "saving" && "Saving…"}
            {status === "saved" && savedAt && `Saved at ${savedAt}`}
            {status === "error" && message}
          </p>
        </div>
      </form>
    </FormErrorsProvider>
  );
}
