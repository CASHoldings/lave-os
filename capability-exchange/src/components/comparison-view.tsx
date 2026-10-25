import type { Comparison, RequirementOutcome, CompatibilityOutcome } from "@/server/services/matching";
import { Badge } from "./ui";

const outcomeMeta: Record<RequirementOutcome, { label: string; tone: "success" | "info" | "warning" | "neutral" }> = {
  supported: { label: "Supported by evidence", tone: "success" },
  stated: { label: "Stated, not yet evidenced", tone: "info" },
  below_level: { label: "Potential gap", tone: "warning" },
  review: { label: "Needs reading", tone: "neutral" },
  not_provided: { label: "Not provided", tone: "neutral" },
};

const compatMeta: Record<CompatibilityOutcome, { label: string; tone: "success" | "warning" | "neutral" }> = {
  compatible: { label: "Compatible", tone: "success" },
  conflict: { label: "Differs", tone: "warning" },
  not_provided: { label: "Not provided", tone: "neutral" },
  not_comparable: { label: "Not comparable", tone: "neutral" },
  not_applicable: { label: "Not specified", tone: "neutral" },
};

/** Requirement-by-requirement comparison. Deliberately shows no overall score. */
export function ComparisonView({ comparison, compact = false }: { comparison: Comparison; compact?: boolean }) {
  const groups: { title: string; outcomes: RequirementOutcome[]; help: string }[] = [
    { title: "Confirmed by evidence", outcomes: ["supported"], help: "Matching capability with an evidenced example or assessment." },
    { title: "Unconfirmed", outcomes: ["stated", "review"], help: "Stated by the candidate, or related wording to read." },
    { title: "Potential gaps", outcomes: ["below_level"], help: "Stated proficiency below the level asked for." },
    { title: "Not addressed in the profile", outcomes: ["not_provided"], help: "Missing information, not a demonstrated gap." },
  ];
  const s = comparison.summary;
  return (
    <div className="space-y-6">
      <p className="text-sm">
        {s.essentialSupported} of {s.essentialTotal} essential requirements are supported by evidence. {s.stated + s.review} unconfirmed, {s.gaps} potential gap{s.gaps === 1 ? "" : "s"}, {s.notProvided} not addressed.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {groups.map((g) => {
          const items = comparison.requirements.filter((r) => g.outcomes.includes(r.outcome));
          return (
            <section key={g.title} aria-label={g.title} className="rounded-lg border border-line p-4">
              <h4 className="font-semibold">{g.title}</h4>
              <p className="text-xs text-ink-soft">{g.help}</p>
              {items.length === 0 ? (
                <p className="mt-2 text-sm text-ink-muted">None</p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {items.map((r) => (
                    <li key={r.requirementId} className="text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{r.label}</span>
                        <Badge tone={r.importance === "essential" ? "accent" : "neutral"}>{r.importance}</Badge>
                        <Badge tone={outcomeMeta[r.outcome].tone}>{outcomeMeta[r.outcome].label}</Badge>
                      </div>
                      {!compact && <p className="mt-1 text-ink-muted">{r.explanation}</p>}
                      {!compact && r.refs.length > 0 && (
                        <p className="mt-1 text-xs text-ink-soft">Based on: {r.refs.map((ref) => ref.label).join("; ")}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      <section aria-label="Availability and preferences">
        <h4 className="font-semibold">Availability and preferences</h4>
        <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
          {comparison.compatibility.map((c) => (
            <li key={c.key} className="flex flex-col gap-1 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <span>
                <strong>{c.label}:</strong> {c.explanation}
              </span>
              <Badge tone={compatMeta[c.outcome].tone}>{compatMeta[c.outcome].label}</Badge>
            </li>
          ))}
        </ul>
      </section>
      {!compact && comparison.supportingExamples.length > 0 && (
        <p className="text-sm text-ink-muted">Relevant examples: {comparison.supportingExamples.map((e) => e.label).join("; ")}.</p>
      )}
    </div>
  );
}
