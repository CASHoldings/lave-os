import type { ProfileView } from "@/server/services/profile-view";
import { labelOf, opportunityTypes, profileModules } from "@/config/taxonomy";

/**
 * A fact the assistant may cite. Every factual sentence it returns must reference at
 * least one of these ids; anything else is reported as unsupported.
 */
export interface ContextFact {
  ref: string;
  label: string;
  text: string;
  status?: string;
}

/**
 * Turns a permission-filtered profile view into citable facts. Contact details,
 * references, compensation, private notes, names and values answers are left out:
 * the assistant never needs them, so they are never sent.
 */
export function profileFacts(view: ProfileView): ContextFact[] {
  const facts: ContextFact[] = [];
  const add = (ref: string, label: string, text: string | null | undefined, status?: string) => {
    if (text && text.trim()) facts.push({ ref, label, text: text.trim().slice(0, 2000), status });
  };
  add("field:headline", "Headline", view.headline);
  add("field:introduction", "Introduction", view.introduction);
  add("field:sectors", "Sectors", view.sectors.join(", "));
  add("field:opportunity_types", "Looking for", view.opportunityTypes.map((t) => labelOf(opportunityTypes, t)).join(", "));
  add("field:years_experience", "Years of experience", view.yearsExperience != null ? String(view.yearsExperience) : null);
  for (const c of view.capabilities) {
    add(`capability:${c.id}`, `Capability: ${c.name}`, `${c.name} (${c.tier} tier, self-rated ${c.selfProficiency}${c.assessedProficiency ? `, assessed ${c.assessedProficiency}` : ""})`);
  }
  for (const e of view.engagements) {
    const name = `Project “${e.title}”`;
    add(`engagement:${e.id}:summary`, name, [e.title, e.roleTitle, e.organisationLabel, e.stageReached ? `stage reached: ${e.stageReached}` : null, e.status].filter(Boolean).join(" · "));
    add(`engagement:${e.id}:context`, `${name}: context`, e.context);
    add(`engagement:${e.id}:individual_actions`, `${name}: what they did`, e.individualActions);
    add(`engagement:${e.id}:team_contribution`, `${name}: team contribution`, e.teamContribution);
    add(`engagement:${e.id}:outcomes`, `${name}: outcomes`, e.outcomes);
    add(`engagement:${e.id}:lessons`, `${name}: lessons`, e.lessons);
    const figures = [
      e.projectValue && `overall project value ${e.valueCurrency ?? ""} ${e.projectValue}`,
      e.revenueGenerated && `revenue generated ${e.valueCurrency ?? ""} ${e.revenueGenerated}`,
      e.budgetManaged && `budget managed ${e.valueCurrency ?? ""} ${e.budgetManaged}`,
      e.personallyAttributableValue && `personally attributable ${e.valueCurrency ?? ""} ${e.personallyAttributableValue}`,
    ].filter(Boolean);
    if (figures.length) add(`engagement:${e.id}:figures`, `${name}: figures`, figures.join("; "));
    for (const c of e.claims) add(`claim:${c.id}`, `Claim`, c.text, c.verificationStatus);
  }
  for (const c of view.standaloneClaims) add(`claim:${c.id}`, "Claim", c.text, c.verificationStatus);
  for (const l of view.learning) add(`learning:${l.id}`, `Learning: ${l.title}`, [l.title, l.provider, l.year, l.takeaway].filter(Boolean).join(" · "));
  for (const m of view.modules) {
    const mod = profileModules.find((x) => x.key === m.moduleKey);
    if (!mod || mod.excludedFromMatching) continue;
    const q = mod.questions.find((x) => x.key === m.questionKey);
    add(`module:${m.moduleKey}:${m.questionKey}`, `${mod.title}: ${q?.label ?? m.questionKey}`, m.answer);
  }
  return facts;
}

/** Keeps only references that exist in the context. */
export function validRefs(refs: string[], facts: ContextFact[]): string[] {
  const known = new Set(facts.map((f) => f.ref));
  return Array.from(new Set(refs.filter((r) => known.has(r))));
}

const NUMBER = /\d[\d,.]*\s*(?:%|percent|k\b|m\b|bn\b|million|billion|thousand)?/gi;
const CURRENCY = /(?:[$€£₦]|\b(?:USD|EUR|GBP|NGN|KES|ZAR|GHS|EGP|MAD|XOF)\b)/g;
const VERIFY = /\b(verified|certified|accredited|audited|award(?:ed)?|proven)\b/gi;
const SUPERLATIVE = /\b(best|top|leading|world[- ]class|first|only)\b/gi;

const normaliseNumber = (s: string) => s.toLowerCase().replace(/[\s,]/g, "");

/**
 * Lists facts present in a suggested rewrite but absent from the original text:
 * numbers, currencies, verification language, superlatives and capitalised names.
 * A rewrite with any of these cannot be approved as-is.
 */
export function introducedFacts(original: string, suggestion: string): string[] {
  const issues: string[] = [];
  const origNumbers = new Set((original.match(NUMBER) ?? []).map(normaliseNumber));
  for (const n of suggestion.match(NUMBER) ?? []) {
    if (!origNumbers.has(normaliseNumber(n))) issues.push(`New figure “${n.trim()}”`);
  }
  const origCurrencies = new Set((original.match(CURRENCY) ?? []).map((c) => c.toUpperCase()));
  for (const c of suggestion.match(CURRENCY) ?? []) if (!origCurrencies.has(c.toUpperCase())) issues.push(`New currency “${c}”`);
  for (const pattern of [VERIFY, SUPERLATIVE]) {
    const orig = new Set((original.match(pattern) ?? []).map((w) => w.toLowerCase()));
    for (const w of suggestion.match(pattern) ?? []) if (!orig.has(w.toLowerCase())) issues.push(`New claim word “${w}”`);
  }
  // Capitalised words not at a sentence start, absent from the original: likely new names.
  const origWords = new Set(original.split(/[^\p{L}\p{N}'-]+/u).map((w) => w.toLowerCase()));
  const tokens = suggestion.split(/(?<=[.!?]\s)|\s+/);
  let sentenceStart = true;
  for (const raw of tokens) {
    const w = raw.replace(/[^\p{L}\p{N}'-]/gu, "");
    if (w && /^\p{Lu}/u.test(w) && !sentenceStart && !origWords.has(w.toLowerCase()) && w !== "I") issues.push(`New name “${w}”`);
    sentenceStart = /[.!?]$/.test(raw.trim());
  }
  return Array.from(new Set(issues));
}

/** Text quoted as a source must actually appear in the text the person supplied. */
export function quoteAppearsIn(quote: string, source: string): boolean {
  const n = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const q = n(quote);
  return q.length >= 3 && n(source).includes(q);
}

/** Wording an assistant must never use about a person: decisions, rankings or inferred traits. */
const JUDGEMENT = /\b(reject|unsuitable|not suitable|do not hire|don't hire|should hire|strong hire|culture fit|personality|too old|too young|overqualified)\b/i;
export const containsJudgement = (text: string) => JUDGEMENT.test(text);
