import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { verificationStatuses } from "@/config/taxonomy";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

/* ------------------------------ Buttons ------------------------------ */

type Variant = "primary" | "secondary" | "ghost" | "danger";
const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 min-h-11";
const buttonVariants: Record<Variant, string> = {
  primary: "bg-accent text-white hover:bg-accent-strong",
  secondary: "border border-line-strong bg-surface text-ink hover:bg-surface-muted",
  ghost: "text-accent-strong hover:bg-accent-soft",
  danger: "bg-danger text-white hover:opacity-90",
};

export function buttonClass(variant: Variant = "primary", extra?: string) {
  return cx(buttonBase, buttonVariants[variant], extra);
}

export function Button({ variant = "primary", className, ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button {...props} className={buttonClass(variant, className)} />;
}

export function ButtonLink({ variant = "primary", className, ...props }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link {...props} className={buttonClass(variant, className)} />;
}

/* ------------------------------ Layout ------------------------------- */

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  return (
    <header className="mb-8 flex flex-col gap-4 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-3xl">
        {eyebrow && <p className="mb-1 text-sm font-semibold uppercase tracking-wide text-accent-strong">{eyebrow}</p>}
        <h1 className="text-3xl sm:text-4xl">{title}</h1>
        {description && <div className="mt-2 text-ink-muted">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Card({ children, className, as: As = "section", ...rest }: { children: ReactNode; className?: string; as?: "section" | "article" | "div" | "li" } & Record<string, unknown>) {
  return (
    <As {...rest} className={cx("rounded-[var(--radius-card)] border border-line bg-surface p-5 sm:p-6", className)}>
      {children}
    </As>
  );
}

export function SectionTitle({ children, id, description }: { children: ReactNode; id?: string; description?: ReactNode }) {
  return (
    <div className="mb-4">
      <h2 id={id} className="text-xl sm:text-2xl">
        {children}
      </h2>
      {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
    </div>
  );
}

/* ------------------------------ Feedback ----------------------------- */

const alertStyles = {
  info: "border-info/30 bg-info-soft text-info",
  success: "border-success/30 bg-success-soft text-success",
  warning: "border-warning/30 bg-warning-soft text-warning",
  error: "border-danger/30 bg-danger-soft text-danger",
};

export function Alert({ tone = "info", title, children, className }: { tone?: keyof typeof alertStyles; title?: string; children?: ReactNode; className?: string }) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cx("rounded-lg border px-4 py-3 text-sm", alertStyles[tone], className)}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={title ? "mt-1" : ""}>{children}</div>}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface/60 px-6 py-10 text-center">
      <p className="font-serif text-lg text-ink">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-prose text-sm text-ink-muted">{children}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/* ------------------------------- Badges ------------------------------ */

const badgeTones = {
  neutral: "bg-surface-muted text-ink-muted border-line",
  accent: "bg-accent-soft text-accent-strong border-accent/30",
  success: "bg-success-soft text-success border-success/30",
  warning: "bg-warning-soft text-warning border-warning/30",
  danger: "bg-danger-soft text-danger border-danger/30",
  info: "bg-info-soft text-info border-info/30",
};

export function Badge({ tone = "neutral", children, title }: { tone?: keyof typeof badgeTones; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap", badgeTones[tone])}>
      {children}
    </span>
  );
}

const statusTone = {
  self_reported: "neutral",
  evidence_supplied: "info",
  independently_verified: "success",
  clarification_requested: "warning",
} as const;

const statusIcon = {
  self_reported: "○",
  evidence_supplied: "◐",
  independently_verified: "✓",
  clarification_requested: "?",
} as const;

/** Evidence label shown next to every claim. Text, icon and colour all carry the meaning. */
export function VerificationBadge({ status }: { status: keyof typeof statusTone }) {
  const meta = verificationStatuses.find((s) => s.value === status)!;
  return (
    <Badge tone={statusTone[status]} title={meta.help}>
      <span aria-hidden="true">{statusIcon[status]}</span>
      {meta.label}
    </Badge>
  );
}

export function VisibilityBadge({ visibility }: { visibility: string }) {
  if (visibility === "private") return <Badge tone="neutral">🔒 Private</Badge>;
  if (visibility === "on_introduction") return <Badge tone="info">Shared after you accept an introduction</Badge>;
  return <Badge tone="accent">Visible to approved employers</Badge>;
}

export function DemoTag() {
  return <Badge tone="warning">Fictional demo data</Badge>;
}

/* ------------------------------- Misc -------------------------------- */

export function NotProvided({ children = "Not provided" }: { children?: ReactNode }) {
  return <span className="italic text-ink-soft">{children}</span>;
}

export function DefinitionRow({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-line py-3 last:border-0 sm:grid-cols-[12rem_1fr] sm:gap-4">
      <dt className="text-sm font-semibold text-ink-muted">{term}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}

export function Progress({ value, label }: { value: number; label: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span className="text-ink-muted">{label}</span>
        <span className="font-semibold">{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-surface-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className="h-2 rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function formatMoney(amount: string | number | null | undefined, currency: string | null | undefined) {
  if (amount === null || amount === undefined || amount === "") return null;
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  const compact = n >= 1_000_000 ? `${(n / 1_000_000).toLocaleString("en-GB", { maximumFractionDigits: 1 })}m` : n.toLocaleString("en-GB", { maximumFractionDigits: 0 });
  return `${currency ?? ""} ${compact}`.trim();
}

export function formatDate(value: string | Date | null | undefined) {
  if (!value) return null;
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function formatMonth(value: string | null | undefined) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}
