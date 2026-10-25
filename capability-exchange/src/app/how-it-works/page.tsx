import type { Metadata } from "next";
import { Card, PageHeader, VerificationBadge, Badge } from "@/components/ui";
import { verificationStatuses } from "@/config/taxonomy";

export const metadata: Metadata = { title: "How evidence and matching work" };

export default function HowItWorksPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="How evidence and matching work" description="The rules behind the labels you see on profiles and comparisons." />
      <Card>
        <h2 className="text-xl">Evidence labels</h2>
        <ul className="mt-4 space-y-4">
          {verificationStatuses.map((s) => (
            <li key={s.value}>
              <VerificationBadge status={s.value} />
              <p className="mt-1 text-sm text-ink-muted">{s.help}</p>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-ink-muted">
          Only a platform reviewer can mark a claim independently verified. The review records the method, the scope of what was checked and the evidence reviewed. If the owner later changes the wording, the verification no longer applies and the label changes back.
        </p>
      </Card>
      <Card>
        <h2 className="text-xl">Comparing a profile with an opportunity</h2>
        <p className="mt-2 text-ink-muted">There is no overall score. Each requirement is assessed separately:</p>
        <ul className="mt-4 space-y-3 text-sm">
          <li><Badge tone="success">Supported by evidence</Badge> A matching capability at the required level, with a related example that has evidence or verification.</li>
          <li><Badge tone="info">Stated</Badge> A matching capability is listed (self-rated) but no supporting evidence yet.</li>
          <li><Badge tone="warning">Potential gap</Badge> A matching capability is listed but self-rated below the required level, or a stated preference conflicts (for example, availability).</li>
          <li><Badge tone="neutral">Needs reading</Badge> Related wording appears in examples; a person should read and judge.</li>
          <li><Badge tone="neutral">Not provided</Badge> The profile does not address it. Missing information is never treated as a gap.</li>
        </ul>
        <p className="mt-4 text-sm text-ink-muted">
          Search results are ordered by keyword relevance when keywords are used, otherwise by most recently updated. Values, motivations, names, photographs and writing style are never used to filter or order people. Compensation is only compared when the candidate chose to share it, in the same currency and period; no currency conversion is applied.
        </p>
      </Card>
    </div>
  );
}
