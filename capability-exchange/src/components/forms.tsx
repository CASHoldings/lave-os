"use client";

import { createContext, useActionState, useContext, useEffect, useId, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Alert, Button, cx } from "./ui";
import type { ActionState } from "@/lib/action-state";

const FormContext = createContext<{ errors: Record<string, string> }>({ errors: {} });

/**
 * A form bound to a server action. Shows the action's message and passes field errors
 * to the fields inside it. Works without JavaScript as a plain form post.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  id,
  "aria-label": ariaLabel,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  id?: string;
  "aria-label"?: string;
}) {
  const [state, formAction] = useActionState(action, { ok: false } as ActionState);
  const ref = useRef<HTMLFormElement>(null);
  const messageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
    if (state.message) messageRef.current?.focus();
  }, [state, resetOnSuccess]);
  return (
    <FormContext.Provider value={{ errors: state.fieldErrors ?? {} }}>
      <form ref={ref} action={formAction} className={cx("space-y-5", className)} id={id} aria-label={ariaLabel} noValidate>
        {state.message && (
          <div ref={messageRef} tabIndex={-1} className="outline-none">
            <Alert tone={state.ok ? "success" : "error"}>{state.message}</Alert>
          </div>
        )}
        {state.fieldErrors?._form && <Alert tone="error">{state.fieldErrors._form}</Alert>}
        {children}
      </form>
    </FormContext.Provider>
  );
}

export function SubmitButton({ children, pendingLabel = "Saving…", variant = "primary", className, name, value }: { children: ReactNode; pendingLabel?: string; variant?: "primary" | "secondary" | "danger" | "ghost"; className?: string; name?: string; value?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending} aria-disabled={pending} className={className} name={name} value={value}>
      {pending ? pendingLabel : children}
    </Button>
  );
}

export function FormErrorsProvider({ errors, children }: { errors: Record<string, string>; children: ReactNode }) {
  return <FormContext.Provider value={{ errors }}>{children}</FormContext.Provider>;
}

export function useFieldError(name: string) {
  return useContext(FormContext).errors[name];
}

const inputClass =
  "block w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-ink placeholder:text-ink-soft focus:border-accent aria-[invalid=true]:border-danger";

interface FieldProps {
  name: string;
  label: string;
  hint?: ReactNode;
  required?: boolean;
  className?: string;
  error?: string;
}

function FieldShell({ id, label, hint, required, error, children, className }: FieldProps & { id: string; children: ReactNode }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold text-ink">
        {label}
        {required ? <span className="text-danger"> *</span> : <span className="font-normal text-ink-soft"> (optional)</span>}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="mb-1.5 text-sm text-ink-muted">
          {hint}
        </p>
      )}
      {children}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-sm font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function describedBy(id: string, hint?: ReactNode, error?: string) {
  return [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
}

export function TextField(props: FieldProps & { type?: string; defaultValue?: string | number | null; placeholder?: string; autoComplete?: string; inputMode?: "numeric" | "decimal" | "email" | "url" | "tel" | "text"; maxLength?: number; list?: string }) {
  const id = useId();
  const error = useFieldError(props.name) ?? props.error;
  return (
    <FieldShell {...props} id={id} error={error}>
      <input
        id={id}
        name={props.name}
        type={props.type ?? "text"}
        defaultValue={props.defaultValue ?? undefined}
        placeholder={props.placeholder}
        autoComplete={props.autoComplete}
        inputMode={props.inputMode}
        maxLength={props.maxLength}
        list={props.list}
        required={props.required}
        aria-invalid={!!error}
        aria-describedby={describedBy(id, props.hint, error)}
        className={inputClass}
      />
    </FieldShell>
  );
}

export function TextAreaField(props: FieldProps & { defaultValue?: string | null; rows?: number; placeholder?: string; maxLength?: number }) {
  const id = useId();
  const error = useFieldError(props.name) ?? props.error;
  return (
    <FieldShell {...props} id={id} error={error}>
      <textarea
        id={id}
        name={props.name}
        rows={props.rows ?? 4}
        defaultValue={props.defaultValue ?? undefined}
        placeholder={props.placeholder}
        maxLength={props.maxLength}
        required={props.required}
        aria-invalid={!!error}
        aria-describedby={describedBy(id, props.hint, error)}
        className={inputClass}
      />
    </FieldShell>
  );
}

export function SelectField(props: FieldProps & { options: readonly { value: string; label: string }[]; defaultValue?: string | null; placeholder?: string }) {
  const id = useId();
  const error = useFieldError(props.name) ?? props.error;
  return (
    <FieldShell {...props} id={id} error={error}>
      <select
        id={id}
        name={props.name}
        defaultValue={props.defaultValue ?? ""}
        required={props.required}
        aria-invalid={!!error}
        aria-describedby={describedBy(id, props.hint, error)}
        className={inputClass}
      >
        {!props.required || props.placeholder ? <option value="">{props.placeholder ?? "Not specified"}</option> : null}
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export function CheckboxGroup(props: FieldProps & { options: readonly { value: string; label: string; help?: string }[]; defaultValue?: readonly string[] }) {
  const id = useId();
  const error = useFieldError(props.name) ?? props.error;
  return (
    <fieldset className={props.className} aria-describedby={describedBy(id, props.hint, error)}>
      <legend className="mb-1 text-sm font-semibold text-ink">
        {props.label}
        {!props.required && <span className="font-normal text-ink-soft"> (optional)</span>}
      </legend>
      {props.hint && (
        <p id={`${id}-hint`} className="mb-2 text-sm text-ink-muted">
          {props.hint}
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {props.options.map((o) => (
          <label key={o.value} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-line bg-surface px-3 py-2.5 hover:border-accent">
            <input type="checkbox" name={props.name} value={o.value} defaultChecked={props.defaultValue?.includes(o.value)} className="mt-1 h-4 w-4 accent-[var(--color-accent)]" />
            <span>
              <span className="block text-sm font-medium">{o.label}</span>
              {o.help && <span className="block text-xs text-ink-muted">{o.help}</span>}
            </span>
          </label>
        ))}
      </div>
      {error && (
        <p id={`${id}-error`} className="mt-1 text-sm font-semibold text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}

export function RadioGroup(props: FieldProps & { options: readonly { value: string; label: string; help?: string }[]; defaultValue?: string | null }) {
  const id = useId();
  const error = useFieldError(props.name) ?? props.error;
  return (
    <fieldset className={props.className} aria-describedby={describedBy(id, props.hint, error)}>
      <legend className="mb-1 text-sm font-semibold text-ink">{props.label}</legend>
      {props.hint && (
        <p id={`${id}-hint`} className="mb-2 text-sm text-ink-muted">
          {props.hint}
        </p>
      )}
      <div className="grid gap-2">
        {props.options.map((o) => (
          <label key={o.value} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-line bg-surface px-3 py-2.5 hover:border-accent">
            <input type="radio" name={props.name} value={o.value} defaultChecked={props.defaultValue === o.value} required={props.required} className="mt-1 h-4 w-4 accent-[var(--color-accent)]" />
            <span>
              <span className="block text-sm font-medium">{o.label}</span>
              {o.help && <span className="block text-xs text-ink-muted">{o.help}</span>}
            </span>
          </label>
        ))}
      </div>
      {error && (
        <p id={`${id}-error`} className="mt-1 text-sm font-semibold text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}

export function Checkbox({ name, label, hint, defaultChecked, value = "on" }: { name: string; label: ReactNode; hint?: ReactNode; defaultChecked?: boolean; value?: string }) {
  const id = useId();
  const error = useFieldError(name);
  return (
    <div>
      <label htmlFor={id} className="flex min-h-11 cursor-pointer items-start gap-3">
        <input id={id} type="checkbox" name={name} value={value} defaultChecked={defaultChecked} aria-describedby={describedBy(id, hint, error)} className="mt-1 h-4 w-4 accent-[var(--color-accent)]" />
        <span>
          <span className="block text-sm font-medium">{label}</span>
          {hint && (
            <span id={`${id}-hint`} className="block text-sm text-ink-muted">
              {hint}
            </span>
          )}
        </span>
      </label>
      {error && (
        <p id={`${id}-error`} className="mt-1 text-sm font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** A small form for one-click actions (delete, revoke, publish) that still reports errors. */
export function InlineAction({
  action,
  children,
  hidden,
  variant = "secondary",
  pendingLabel = "Working…",
  confirm,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  children: ReactNode;
  hidden?: Record<string, string>;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  pendingLabel?: string;
  confirm?: string;
}) {
  const [state, formAction] = useActionState(action, { ok: false } as ActionState);
  return (
    <form
      action={formAction}
      className="inline-flex flex-col items-start gap-1"
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {Object.entries(hidden ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <SubmitButton variant={variant} pendingLabel={pendingLabel}>
        {children}
      </SubmitButton>
      {state.message && !state.ok && (
        <span role="alert" className="text-sm font-semibold text-danger">
          {state.message}
        </span>
      )}
      {state.message && state.ok && (
        <span role="status" className="text-sm text-success">
          {state.message}
        </span>
      )}
    </form>
  );
}
