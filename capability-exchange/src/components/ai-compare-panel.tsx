import { getCurrentActor } from "@/server/auth/current";
import { listSuggestions } from "@/server/services/assistant";
import { aiStatus } from "@/server/ai/provider";
import { ActionForm, SubmitButton } from "./forms";
import { Alert } from "./ui";
import { AiSourceBadge } from "./ai-badge";
import { explainComparisonAction } from "@/app/assistant-actions";

/** Optional plain-language explanation of the rule-based comparison. Never a verdict. */
export async function AiComparePanel({ profileId, opportunityId }: { profileId: string; opportunityId: string }) {
  const actor = await getCurrentActor();
  if (!actor) return null;
  const status = aiStatus();
  const latest = (await listSuggestions(actor, { kinds: ["comparison"], targetId: opportunityId })).find((s) => s.profileId === profileId);
  const o = latest?.output as { summary: { text: string; refs: string[] }[]; unsupported: string[]; questionsToAsk: string[]; facts: Record<string, string> } | undefined;
  return (
    <div className="rounded-lg border border-line bg-surface-muted/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Plain-language explanation</h3>
        {latest && <AiSourceBadge isDemonstration={latest.isDemonstration} model={latest.model} />}
      </div>
      {status.mode === "off" ? (
        <p className="mt-2 text-sm text-ink-muted">{status.description}</p>
      ) : (
        <>
          {o && (
            <div className="mt-3 space-y-2 text-sm">
              <ul className="space-y-2">
                {o.summary.map((x, i) => (
                  <li key={i}>{x.text}<span className="block text-xs text-ink-soft">Source: {x.refs.map((r) => o.facts[r] ?? r).join("; ")}</span></li>
                ))}
              </ul>
              {o.unsupported.length > 0 && <Alert tone="warning">Some statements were removed because they had no source in the profile or expressed a judgement.</Alert>}
              {o.questionsToAsk.length > 0 && (
                <>
                  <p className="font-semibold">Questions you could ask</p>
                  <ul className="list-disc pl-5">{o.questionsToAsk.map((q) => <li key={q}>{q}</li>)}</ul>
                </>
              )}
            </div>
          )}
          <ActionForm action={explainComparisonAction} className="mt-3" aria-label="Explain this comparison">
            <input type="hidden" name="profileId" value={profileId} />
            <input type="hidden" name="opportunityId" value={opportunityId} />
            <SubmitButton variant="secondary" pendingLabel="Explaining…">{o ? "Explain again" : "Explain this comparison"}</SubmitButton>
          </ActionForm>
          <p className="mt-2 text-xs text-ink-soft">Uses only what this person shares with you. It does not score, rank or recommend, and the decision remains yours.</p>
        </>
      )}
    </div>
  );
}
