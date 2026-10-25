import { proficiencyRank, labelOf, opportunityTypes, workArrangements, type Proficiency } from "@/config/taxonomy";
import type { ProfileView, ViewClaim } from "./profile-view";
import type { OpportunityRow, RequirementRow } from "./employer";

/**
 * Compares a profile (as the viewer is allowed to see it) with an opportunity.
 * There is deliberately no overall score. Each requirement gets one of these:
 *
 * - supported:      a matching capability at or above the required level, backed by a
 *                   project example with evidence supplied or independent verification,
 *                   or by an assessed proficiency.
 * - stated:         a matching capability is listed (self-rated) but no evidenced example yet.
 * - below_level:    a matching capability is listed but self-rated below the required level.
 *                   This is the only capability outcome treated as a potential gap.
 * - review:         no structured match, but related wording appears in visible examples.
 *                   A person needs to read and judge.
 * - not_provided:   nothing in the visible profile addresses it. Missing information is
 *                   not evidence of a gap, and it is never presented as one.
 *
 * Values, motivations, names, photographs and writing style are never inputs.
 */

export type RequirementOutcome = "supported" | "stated" | "below_level" | "review" | "not_provided";

export interface SourceRef {
  type: "capability" | "engagement" | "claim" | "evidence" | "field";
  id: string;
  label: string;
}

export interface RequirementAssessment {
  requirementId: string;
  label: string;
  importance: "essential" | "desirable";
  kind: string;
  minProficiency: string | null;
  outcome: RequirementOutcome;
  explanation: string;
  refs: SourceRef[];
}

export type CompatibilityOutcome = "compatible" | "conflict" | "not_provided" | "not_comparable" | "not_applicable";

export interface CompatibilityCheck {
  key: "engagement_type" | "work_arrangement" | "start_date" | "hours" | "compensation";
  label: string;
  outcome: CompatibilityOutcome;
  explanation: string;
}

export interface Comparison {
  requirements: RequirementAssessment[];
  compatibility: CompatibilityCheck[];
  relevantCapabilities: SourceRef[];
  supportingExamples: SourceRef[];
  summary: { supported: number; stated: number; gaps: number; review: number; notProvided: number; essentialTotal: number; essentialSupported: number };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const STOP = new Set(["and", "the", "of", "in", "for", "to", "a", "an", "with", "on", "or", "experience", "skills", "skill", "management"]);
const tokens = (s: string) => norm(s).split(" ").filter((t) => t.length > 2 && !STOP.has(t));

function capabilityMatches(req: RequirementRow, capName: string, capId: string) {
  if (req.capabilityId && req.capabilityId === capId) return true;
  const a = norm(req.label), b = norm(capName);
  return a === b || (a.length > 3 && b.includes(a)) || (b.length > 3 && a.includes(b));
}

const strongClaim = (c: ViewClaim) => c.verificationStatus === "independently_verified" || c.verificationStatus === "evidence_supplied";

export function compareProfileToOpportunity(view: ProfileView, opp: OpportunityRow, requirements: RequirementRow[], today = new Date()): Comparison {
  const results: RequirementAssessment[] = [];
  const relevant = new Map<string, SourceRef>();
  const examples = new Map<string, SourceRef>();

  for (const req of requirements) {
    const base = { requirementId: req.id, label: req.label, importance: req.importance, kind: req.kind, minProficiency: req.minProficiency };
    const cap = view.capabilities.find((c) => capabilityMatches(req, c.name, c.capabilityId));

    if (cap) {
      const capRef: SourceRef = { type: "capability", id: cap.id, label: cap.name };
      relevant.set(cap.id, capRef);
      const required = proficiencyRank(req.minProficiency as Proficiency | null);
      const selfRank = proficiencyRank(cap.selfProficiency as Proficiency);
      const assessedRank = proficiencyRank(cap.assessedProficiency as Proficiency | null);
      const exampleEngs = view.engagements.filter((e) => e.capabilities.some((c) => c.id === cap.capabilityId));
      const evidenced = exampleEngs.flatMap((e) => e.claims.filter(strongClaim).map((c) => ({ e, c })));
      for (const e of exampleEngs) examples.set(e.id, { type: "engagement", id: e.id, label: e.title });
      const refs: SourceRef[] = [capRef, ...exampleEngs.map((e) => ({ type: "engagement" as const, id: e.id, label: e.title })), ...evidenced.map(({ c }) => ({ type: "claim" as const, id: c.id, label: c.text.slice(0, 80) }))];

      if (required && assessedRank >= required) {
        results.push({ ...base, outcome: "supported", explanation: `Assessed proficiency (${cap.assessedProficiency}) meets the required level.`, refs });
      } else if (required && selfRank < required) {
        results.push({ ...base, outcome: "below_level", explanation: `Self-rated ${cap.selfProficiency}; the requirement asks for ${req.minProficiency} or above.`, refs });
      } else if (evidenced.length) {
        const verified = evidenced.some(({ c }) => c.verificationStatus === "independently_verified");
        results.push({
          ...base,
          outcome: "supported",
          explanation: `Listed as ${cap.selfProficiency} (self-rated), with ${evidenced.length} related claim${evidenced.length > 1 ? "s" : ""} that ${verified ? "include independently verified evidence" : "have evidence supplied"}.`,
          refs,
        });
      } else {
        results.push({
          ...base,
          outcome: "stated",
          explanation: exampleEngs.length
            ? `Listed as ${cap.selfProficiency} (self-rated), with ${exampleEngs.length} related example${exampleEngs.length > 1 ? "s" : ""} but no supporting evidence yet.`
            : `Listed as ${cap.selfProficiency} (self-rated). No related project example yet.`,
          refs,
        });
      }
      continue;
    }

    // No structured capability match: look for related wording in visible examples for a person to review.
    const reqTokens = tokens(req.label);
    const hits: SourceRef[] = [];
    if (reqTokens.length) {
      for (const e of view.engagements) {
        const text = norm([e.title, e.roleTitle, e.sector, e.context, e.individualActions, e.outcomes].filter(Boolean).join(" "));
        const overlap = reqTokens.filter((t) => text.includes(t)).length;
        if (overlap >= Math.min(2, reqTokens.length)) hits.push({ type: "engagement", id: e.id, label: e.title });
      }
      for (const lang of view.languages) if (req.kind === "language" && norm(lang).includes(norm(req.label))) hits.push({ type: "field", id: "languages", label: lang });
    }
    if (req.kind === "language" && hits.some((h) => h.type === "field")) {
      results.push({ ...base, outcome: "stated", explanation: "Listed among the candidate's languages (self-reported).", refs: hits });
    } else if (hits.length) {
      for (const h of hits) if (h.type === "engagement") examples.set(h.id, h);
      results.push({ ...base, outcome: "review", explanation: "Related wording appears in these examples. Read them to judge whether the requirement is met.", refs: hits.slice(0, 4) });
    } else {
      results.push({ ...base, outcome: "not_provided", explanation: "The visible profile does not address this. That is missing information, not a demonstrated gap.", refs: [] });
    }
  }

  const compatibility = compatibilityChecks(view, opp, today);
  const count = (o: RequirementOutcome) => results.filter((r) => r.outcome === o).length;
  return {
    requirements: results,
    compatibility,
    relevantCapabilities: [...relevant.values()],
    supportingExamples: [...examples.values()],
    summary: {
      supported: count("supported"),
      stated: count("stated"),
      gaps: count("below_level"),
      review: count("review"),
      notProvided: count("not_provided"),
      essentialTotal: results.filter((r) => r.importance === "essential").length,
      essentialSupported: results.filter((r) => r.importance === "essential" && r.outcome === "supported").length,
    },
  };
}

export function compatibilityChecks(view: ProfileView, opp: OpportunityRow, today = new Date()): CompatibilityCheck[] {
  const checks: CompatibilityCheck[] = [];
  const typeLabel = labelOf(opportunityTypes, opp.engagementType);

  if (!view.opportunityTypes.length) checks.push({ key: "engagement_type", label: "Engagement type", outcome: "not_provided", explanation: "The candidate has not said which engagement types they want." });
  else if (view.opportunityTypes.includes(opp.engagementType))
    checks.push({ key: "engagement_type", label: "Engagement type", outcome: "compatible", explanation: `Open to ${typeLabel.toLowerCase()}.` });
  else checks.push({ key: "engagement_type", label: "Engagement type", outcome: "conflict", explanation: `Has not listed ${typeLabel.toLowerCase()} among preferred engagement types.` });

  if (!opp.workArrangement) checks.push({ key: "work_arrangement", label: "Working arrangement", outcome: "not_applicable", explanation: "The opportunity does not specify one." });
  else if (!view.workArrangements.length) checks.push({ key: "work_arrangement", label: "Working arrangement", outcome: "not_provided", explanation: "The candidate has not stated working preferences." });
  else if (view.workArrangements.includes(opp.workArrangement))
    checks.push({ key: "work_arrangement", label: "Working arrangement", outcome: "compatible", explanation: `Open to ${labelOf(workArrangements, opp.workArrangement).toLowerCase()} work.` });
  else
    checks.push({
      key: "work_arrangement",
      label: "Working arrangement",
      outcome: "conflict",
      explanation: `Prefers ${view.workArrangements.map((w) => labelOf(workArrangements, w).toLowerCase()).join(" or ")}${view.relocation === "open" ? "; open to relocation" : ""}.`,
    });

  const a = view.availability;
  if (!a.status) checks.push({ key: "start_date", label: "Availability", outcome: "not_provided", explanation: "Availability not provided." });
  else if (a.status === "not_available") checks.push({ key: "start_date", label: "Availability", outcome: "conflict", explanation: "Not currently available." });
  else if (!opp.startDate) checks.push({ key: "start_date", label: "Availability", outcome: "compatible", explanation: availabilityText(a) });
  else {
    let earliest = today;
    if (a.status === "available_from" && a.availableFrom) earliest = new Date(a.availableFrom);
    if (a.noticePeriodWeeks) earliest = new Date(Math.max(earliest.getTime(), today.getTime() + a.noticePeriodWeeks * 7 * 86400_000));
    const start = new Date(opp.startDate);
    checks.push(
      earliest <= start
        ? { key: "start_date", label: "Availability", outcome: "compatible", explanation: `${availabilityText(a)} Can start by ${opp.startDate}.` }
        : { key: "start_date", label: "Availability", outcome: "conflict", explanation: `${availabilityText(a)} Earliest start is about ${earliest.toISOString().slice(0, 10)}, after the planned start of ${opp.startDate}.` },
    );
  }

  if (!opp.hoursPerWeek) checks.push({ key: "hours", label: "Time commitment", outcome: "not_applicable", explanation: "No weekly hours specified." });
  else if (!a.hoursPerWeek) checks.push({ key: "hours", label: "Time commitment", outcome: "not_provided", explanation: "The candidate has not stated weekly hours." });
  else
    checks.push(
      a.hoursPerWeek >= opp.hoursPerWeek
        ? { key: "hours", label: "Time commitment", outcome: "compatible", explanation: `Available for up to ${a.hoursPerWeek} hours a week.` }
        : { key: "hours", label: "Time commitment", outcome: "conflict", explanation: `Available for up to ${a.hoursPerWeek} hours a week; the role needs ${opp.hoursPerWeek}.` },
    );

  const c = view.compensation;
  if (!opp.compensationMax && !opp.compensationMin) checks.push({ key: "compensation", label: "Compensation", outcome: "not_applicable", explanation: "No budget shared on the opportunity." });
  else if (!c || (!c.min && !c.max)) checks.push({ key: "compensation", label: "Compensation", outcome: "not_provided", explanation: "Expectations not shared with employers." });
  else if (c.currency !== opp.compensationCurrency || c.period !== opp.compensationPeriod)
    checks.push({ key: "compensation", label: "Compensation", outcome: "not_comparable", explanation: `Expectations are in ${c.currency} ${c.period}; the budget is in ${opp.compensationCurrency} ${opp.compensationPeriod}. No conversion is applied.` });
  else {
    const candMin = Number(c.min ?? c.max), oppMax = Number(opp.compensationMax ?? opp.compensationMin);
    checks.push(
      candMin <= oppMax
        ? { key: "compensation", label: "Compensation", outcome: "compatible", explanation: "Expectations overlap the stated budget." }
        : { key: "compensation", label: "Compensation", outcome: "conflict", explanation: "Expectations start above the stated budget." },
    );
  }
  return checks;
}

function availabilityText(a: ProfileView["availability"]) {
  if (a.status === "available_now") return "Available now.";
  if (a.status === "available_from") return a.availableFrom ? `Available from ${a.availableFrom}.` : "Available from a date not yet given.";
  if (a.status === "open_to_conversations") return "Open to conversations.";
  return "";
}
