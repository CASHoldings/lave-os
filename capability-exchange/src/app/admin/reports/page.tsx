import Link from "next/link";
import type { Metadata } from "next";
import { requireAdmin } from "@/server/auth/current";
import { listReports } from "@/server/services/admin";
import { ActionForm, SelectField, SubmitButton, TextAreaField } from "@/components/forms";
import { Badge, Card, EmptyState, PageHeader, formatDate } from "@/components/ui";
import { labelOf, reportCategories } from "@/config/taxonomy";
import { resolveReportAction } from "../actions";

export const metadata: Metadata = { title: "Reports" };

const targetHref = (type: string, id: string) => (type === "opportunity" ? `/opportunities/${id}` : type === "profile" ? `/admin/profiles/${id}` : `/admin/organisations`);

export default async function ReportsPage() {
  const actor = await requireAdmin();
  const reports = await listReports(actor);
  return (
    <div>
      <PageHeader title="Reported content" description="Actions restrict access (close, suspend, hide from discovery). They never rewrite what someone wrote." />
      {reports.length === 0 ? (
        <EmptyState title="No reports" />
      ) : (
        <ul className="space-y-4">
          {reports.map((r) => (
            <Card as="li" key={r.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{labelOf(reportCategories, r.category)} · {r.targetType}</p>
                <Badge tone={r.status === "open" ? "warning" : "neutral"}>{r.status}</Badge>
              </div>
              <p className="mt-1 text-sm">{r.details ?? "No details given."}</p>
              <p className="mt-1 text-xs text-ink-soft">Reported {formatDate(r.createdAt)} · <Link href={targetHref(r.targetType, r.targetId)}>View reported item</Link></p>
              {r.resolutionNote && <p className="mt-2 text-sm text-ink-muted">Resolution: {r.resolutionNote}</p>}
              {r.status === "open" && (
                <ActionForm action={resolveReportAction} className="mt-3 max-w-lg" aria-label="Resolve report">
                  <input type="hidden" name="reportId" value={r.id} />
                  <SelectField name="outcome" label="Outcome" required options={[{ value: "dismissed", label: "Dismiss (no action needed)" }, { value: "actioned", label: "Take action" }]} defaultValue="dismissed" />
                  <SelectField
                    name="action"
                    label="Action"
                    required
                    defaultValue="none"
                    options={[
                      { value: "none", label: "None" },
                      ...(r.targetType === "opportunity" ? [{ value: "close_opportunity", label: "Close the opportunity" }, { value: "suspend_organisation", label: "Suspend the organisation" }] : []),
                      ...(r.targetType === "organisation" ? [{ value: "suspend_organisation", label: "Suspend the organisation" }] : []),
                      ...(r.targetType === "profile" ? [{ value: "hide_profile", label: "Hide the profile from discovery" }, { value: "suspend_user", label: "Suspend the account" }] : []),
                    ]}
                  />
                  <TextAreaField name="reason" label="Reason (audit record)" required rows={2} />
                  <SubmitButton variant="secondary">Resolve</SubmitButton>
                </ActionForm>
              )}
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}
