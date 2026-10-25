import { ActionForm, SelectField, SubmitButton, TextAreaField } from "./forms";
import { reportCategories } from "@/config/taxonomy";
import { reportAction } from "@/app/shared/actions";

export function ReportButton({ targetType, targetId }: { targetType: "profile" | "opportunity" | "organisation"; targetId: string }) {
  return (
    <details className="rounded-lg border border-line bg-surface p-3 text-sm">
      <summary className="cursor-pointer font-semibold text-ink-muted">Report a concern</summary>
      <ActionForm action={reportAction} className="mt-3" resetOnSuccess aria-label="Report a concern">
        <input type="hidden" name="targetType" value={targetType} />
        <input type="hidden" name="targetId" value={targetId} />
        <SelectField name="category" label="What is the concern?" required placeholder="Choose one" options={reportCategories} />
        <TextAreaField name="details" label="Details" rows={3} />
        <SubmitButton variant="secondary">Send report</SubmitButton>
      </ActionForm>
    </details>
  );
}
