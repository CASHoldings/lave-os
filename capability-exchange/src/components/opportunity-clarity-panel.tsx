import { getCurrentActor } from "@/server/auth/current";
import { latestClarification } from "@/server/services/assistant";
import { aiStatus } from "@/server/ai/provider";
import { ActionForm, SubmitButton } from "./forms";
import { Card } from "./ui";
import { AiSourceBadge } from "./ai-badge";
import { clarifyOpportunityAction } from "@/app/assistant-actions";

type Item = { field: string; issue: string; suggestion: string };

export async function OpportunityClarityPanel({ opportunityId }: { opportunityId: string }) {
  const actor = await getCurrentActor();
  if (!actor) return null;
  const status = aiStatus();
  const latest = await latestClarification(actor, opportunityId);
  const o = latest?.output as { ruleBased: Item[]; suggestions: Item[]; questions: string[] } | undefined;
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg">Clarity and fairness check</h2>
        {latest && <AiSourceBadge isDemonstration={latest.isDemonstration} model={latest.model} />}
      </div>
      <p className="mt-1 text-sm text-ink-muted">Points out missing details and wording that could exclude people. It never edits your opportunity.</p>
      {o && (
        <div className="mt-3 space-y-3 text-sm">
          {[...o.ruleBased, ...o.suggestions].length === 0 && <p>No issues found.</p>}
          <ul className="space-y-2">
            {[...o.ruleBased, ...o.suggestions].map((s, i) => (
              <li key={i}><strong>{s.issue}</strong> <span className="text-ink-muted">{s.suggestion}</span></li>
            ))}
          </ul>
          {o.questions.length > 0 && <ul className="list-disc pl-5 text-ink-muted">{o.questions.map((q) => <li key={q}>{q}</li>)}</ul>}
        </div>
      )}
      {status.mode === "off" ? (
        <p className="mt-3 text-sm text-ink-soft">{status.description}</p>
      ) : (
        <ActionForm action={clarifyOpportunityAction} className="mt-3" aria-label="Check this opportunity">
          <input type="hidden" name="opportunityId" value={opportunityId} />
          <SubmitButton variant="secondary" pendingLabel="Checking…">{o ? "Check again" : "Check this opportunity"}</SubmitButton>
        </ActionForm>
      )}
    </Card>
  );
}
