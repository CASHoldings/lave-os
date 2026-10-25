import type { ProfileView } from "./profile-view";

/**
 * Deterministic follow-up questions about incomplete or ambiguous records.
 * These are rules, not AI: they run whether or not an AI provider is configured,
 * and they only ask questions. They never change anything or judge capability.
 */
export interface ProfileCheck {
  id: string;
  question: string;
  why: string;
  href: string;
  target: { type: "engagement" | "claim" | "capability" | "profile"; id: string; label: string };
}

const FACILITATION = /\b(facilitat|broker|introduc|originat|pitch|bid|tender|proposal|negotiat|secured?|brought|sourc)/i;
const FIGURE = /(\d[\d,.]*\s*(%|percent|m\b|bn\b|million|billion|k\b))|([$€£₦]|USD|EUR|GBP|NGN|KES|ZAR|GHS)\s?\d/i;
const VERIFY_WORDS = /\b(verified|certified|audited|proven)\b/i;

export function profileChecks(view: ProfileView, now = new Date()): ProfileCheck[] {
  const checks: ProfileCheck[] = [];
  const yearAgo = now.getTime() - 365 * 86400_000;

  for (const e of view.engagements) {
    const href = `/talent/portfolio/${e.id}`;
    const target = { type: "engagement" as const, id: e.id, label: e.title };
    const text = [e.title, e.context, e.individualActions, e.outcomes].filter(Boolean).join(" ");

    if ((e.kind === "project" || e.kind === "role") && !e.stageReached && FACILITATION.test(text)) {
      checks.push({
        id: `stage-${e.id}`,
        question: `You mentioned facilitating or negotiating work on “${e.title}”. Did it reach introduction, proposal, contract award, execution or completion? What was your individual contribution?`,
        why: "Employers read “facilitated” very differently depending on the stage reached.",
        href,
        target,
      });
    }
    if (!e.individualActions) {
      checks.push({ id: `actions-${e.id}`, question: `What did you personally do on “${e.title}”, as distinct from your team or organisation?`, why: "Individual actions are the most useful part of a project record.", href, target });
    }
    if (e.projectValue && !e.personallyAttributableValue && !e.valueNotes) {
      checks.push({
        id: `value-${e.id}`,
        question: `You gave an overall value for “${e.title}”. How much of it, if any, is attributable to your own contribution? Or explain why that cannot be separated.`,
        why: "Overall project value is easily read as value you created. A short note avoids that.",
        href,
        target,
      });
    }
    if ((e.teamSize ?? 0) > 1 && !e.teamContribution) {
      checks.push({ id: `team-${e.id}`, question: `What did the rest of the team do on “${e.title}”?`, why: "Separating team and individual work makes your own contribution clearer.", href, target });
    }
    if (!e.outcomes) {
      checks.push({ id: `outcome-${e.id}`, question: `What changed as a result of “${e.title}”? If it did not finish, say how far it got.`, why: "Outcomes, including partial ones, help readers understand the work.", href, target });
    }
  }

  const allClaims = [...view.engagements.flatMap((e) => e.claims), ...view.standaloneClaims];
  for (const c of allClaims) {
    const href = c.engagementId ? `/talent/portfolio/${c.engagementId}#claim-${c.id}` : `/talent/portfolio#claim-${c.id}`;
    const target = { type: "claim" as const, id: c.id, label: c.text.slice(0, 60) };
    if (c.verificationStatus === "self_reported" && FIGURE.test(c.text)) {
      checks.push({ id: `evidence-${c.id}`, question: `“${c.text.slice(0, 90)}” includes a figure. Can you attach something that supports it? A redacted document or a reference is fine.`, why: "Figures with evidence carry more weight.", href, target });
    }
    if (VERIFY_WORDS.test(c.text) && c.verificationStatus !== "independently_verified") {
      checks.push({
        id: `wording-${c.id}`,
        question: `“${c.text.slice(0, 90)}” uses a word like “verified” or “certified”. Who verified it, and is there a record you can attach?`,
        why: "The “Independently verified” label is only given after a platform review, so wording in the claim itself can confuse readers.",
        href,
        target,
      });
    }
    if (new Date(c.lastConfirmedAt).getTime() < yearAgo) {
      checks.push({ id: `stale-${c.id}`, question: `Is “${c.text.slice(0, 90)}” still accurate?`, why: "It has not been confirmed for over a year.", href, target });
    }
  }

  for (const cap of view.capabilities.filter((c) => c.tier === "core")) {
    const used = view.engagements.some((e) => e.capabilities.some((x) => x.id === cap.capabilityId));
    if (!used) {
      checks.push({
        id: `cap-${cap.id}`,
        question: `“${cap.name}” is one of your core capabilities. Which project or role best shows it?`,
        why: "Linking a capability to an example lets employers see it in context.",
        href: "/talent/portfolio",
        target: { type: "capability", id: cap.id, label: cap.name },
      });
    }
  }
  return checks;
}
