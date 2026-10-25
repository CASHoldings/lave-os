import type { OpportunityRow, RequirementRow } from "@/server/services/employer";
import { compensationPeriods, labelOf, opportunityTypes, proficiencyLevels, workArrangements } from "@/config/taxonomy";
import { Badge, Card, DefinitionRow, NotProvided, formatDate, formatMoney } from "./ui";

export function OpportunityFacts({ o }: { o: OpportunityRow }) {
  const comp = [formatMoney(o.compensationMin, o.compensationCurrency), formatMoney(o.compensationMax, o.compensationCurrency)].filter(Boolean).join(" to ");
  return (
    <dl>
      <DefinitionRow term="Engagement">{labelOf(opportunityTypes, o.engagementType)}</DefinitionRow>
      <DefinitionRow term="Location">{[o.locationText, o.country].filter(Boolean).join(", ") || <NotProvided />}</DefinitionRow>
      <DefinitionRow term="Working arrangement">{o.workArrangement ? labelOf(workArrangements, o.workArrangement) : <NotProvided />}{o.timeZoneRequirements && ` · ${o.timeZoneRequirements}`}</DefinitionRow>
      <DefinitionRow term="Start">{o.startDate ? formatDate(o.startDate) : <NotProvided />}{o.durationText && ` · ${o.durationText}`}{o.hoursPerWeek && ` · ${o.hoursPerWeek} hours a week`}</DefinitionRow>
      <DefinitionRow term="Budget or compensation">{comp ? `${comp} ${labelOf(compensationPeriods, o.compensationPeriod)}` : <NotProvided>Not shared</NotProvided>}</DefinitionRow>
      {o.selectionStages.length > 0 && <DefinitionRow term="Selection stages">{o.selectionStages.join(" → ")}</DefinitionRow>}
    </dl>
  );
}

export function OpportunityBody({ o, requirements }: { o: OpportunityRow; requirements: RequirementRow[] }) {
  const essential = requirements.filter((r) => r.importance === "essential");
  const desirable = requirements.filter((r) => r.importance === "desirable");
  const req = (r: RequirementRow) => (
    <li key={r.id}>
      {r.label}
      {r.minProficiency && <span className="text-ink-muted"> ({labelOf(proficiencyLevels, r.minProficiency)} or above)</span>}
      {r.notes && <span className="block text-sm text-ink-muted">{r.notes}</span>}
    </li>
  );
  return (
    <div className="space-y-6">
      {[
        ["The problem to solve", o.problemStatement],
        ["Expected outcomes", o.expectedOutcomes],
        ["Responsibilities and deliverables", o.responsibilities],
        ["Experience", o.experienceRequirements],
        ["Evidence requested", o.requiredEvidence],
      ].map(([title, body]) =>
        body ? (
          <Card key={title}>
            <h2 className="text-xl">{title}</h2>
            <p className="mt-2 whitespace-pre-line">{body}</p>
          </Card>
        ) : null,
      )}
      <Card>
        <h2 className="text-xl">Requirements</h2>
        <div className="mt-3 grid gap-6 sm:grid-cols-2">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-ink-muted">
              Essential <Badge tone="accent">{essential.length}</Badge>
            </h3>
            <ul className="mt-2 list-disc space-y-1 pl-5">{essential.map(req)}</ul>
          </div>
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-ink-muted">
              Desirable <Badge>{desirable.length}</Badge>
            </h3>
            <ul className="mt-2 list-disc space-y-1 pl-5">{desirable.map(req)}</ul>
          </div>
        </div>
      </Card>
    </div>
  );
}
