import type { Metadata } from "next";
import { requireTalent } from "@/server/auth/current";
import { getOwnProfile } from "@/server/services/profile";
import { buildProfileView } from "@/server/services/profile-view";
import { listSuggestions, type ExtractOutput } from "@/server/services/assistant";
import { aiStatus } from "@/server/ai/provider";
import { ActionForm, InlineAction, SelectField, SubmitButton, TextAreaField } from "@/components/forms";
import { Alert, Badge, Card, EmptyState, PageHeader, formatDate } from "@/components/ui";
import { AiSourceBadge } from "@/components/ai-badge";
import { proficiencyLevels } from "@/config/taxonomy";
import { approveSuggestionAction, extractAction, followUpAction, rejectSuggestionAction, rewriteAction, summariseAction } from "@/app/assistant-actions";

export const metadata: Metadata = { title: "Assistant" };

type Row = Awaited<ReturnType<typeof listSuggestions>>[number];

function Decide({ s, approveLabel = "Approve" }: { s: Row; approveLabel?: string }) {
  if (s.status !== "pending") return <Badge tone={s.status === "approved" ? "success" : "neutral"}>{s.status === "approved" ? "Approved" : "Dismissed"} {formatDate(s.decidedAt)}</Badge>;
  return (
    <div className="flex flex-wrap gap-2">
      <InlineAction action={approveSuggestionAction} hidden={{ suggestionId: s.id }} variant="primary">{approveLabel}</InlineAction>
      <InlineAction action={rejectSuggestionAction} hidden={{ suggestionId: s.id }}>Dismiss</InlineAction>
    </div>
  );
}

function SuggestionCard({ s }: { s: Row }) {
  const head = (title: string) => (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-serif text-lg">{title}</h3>
      <span className="flex items-center gap-2">
        <AiSourceBadge isDemonstration={s.isDemonstration} model={s.model} />
        <span className="text-xs text-ink-soft">{formatDate(s.createdAt)}</span>
      </span>
    </div>
  );

  if (s.kind === "summary") {
    const o = s.output as { sentences: { text: string; refs: string[] }[]; unsupported: string[]; notCovered: string[]; facts: Record<string, string> };
    return (
      <Card>
        {head("Summary of your shareable profile")}
        <ul className="space-y-2">
          {o.sentences.map((x, i) => (
            <li key={i}>
              {x.text} <span className="block text-xs text-ink-soft">Source: {x.refs.map((r) => o.facts[r] ?? r).join("; ")}</span>
            </li>
          ))}
        </ul>
        {o.unsupported.length > 0 && <Alert tone="warning" className="mt-3" title="Left out because they could not be traced to your profile">{o.unsupported.join(" · ")}</Alert>}
        {o.notCovered.length > 0 && <p className="mt-3 text-sm text-ink-muted">Not covered in your profile: {o.notCovered.join(", ")}.</p>}
        <p className="mt-3 text-xs text-ink-soft">For your information only. Summaries are not saved to your profile.</p>
        <div className="mt-3"><Decide s={s} approveLabel="Mark as reviewed" /></div>
      </Card>
    );
  }

  if (s.kind === "rewrite") {
    const o = s.output as { original: string; suggestion: string; changes: string[]; questions: string[]; introducedFacts: string[] };
    return (
      <Card>
        {head(`Clearer wording: ${s.targetType === "introduction" ? "introduction" : s.targetType === "claim" ? "claim" : `project ${s.targetField}`}`)}
        <div className="grid gap-4 md:grid-cols-2">
          <div><p className="text-xs font-semibold uppercase text-ink-muted">Your text</p><p className="mt-1 whitespace-pre-line text-sm">{o.original}</p></div>
          <div><p className="text-xs font-semibold uppercase text-ink-muted">Suggested</p><p className="mt-1 whitespace-pre-line text-sm">{o.suggestion}</p></div>
        </div>
        {o.changes.length > 0 && <p className="mt-3 text-sm text-ink-muted">Changes: {o.changes.join(" ")}</p>}
        {o.introducedFacts.length > 0 && (
          <Alert tone="error" className="mt-3" title="This suggestion adds information that is not in your text">
            {o.introducedFacts.join(" · ")}. It cannot be approved as it stands. Edit it below or dismiss it.
          </Alert>
        )}
        {o.questions.length > 0 && <ul className="mt-3 list-disc pl-5 text-sm">{o.questions.map((q) => <li key={q}>{q}</li>)}</ul>}
        {s.status === "pending" ? (
          <>
            <ActionForm action={approveSuggestionAction} className="mt-4" aria-label="Approve wording">
              <input type="hidden" name="suggestionId" value={s.id} />
              <TextAreaField name="editedText" label="Wording to save (you can edit it)" rows={4} defaultValue={o.introducedFacts.length ? o.original : o.suggestion} />
              <SubmitButton>Approve and save</SubmitButton>
            </ActionForm>
            <div className="mt-2"><InlineAction action={rejectSuggestionAction} hidden={{ suggestionId: s.id }}>Dismiss</InlineAction></div>
          </>
        ) : (
          <div className="mt-3"><Decide s={s} /></div>
        )}
      </Card>
    );
  }

  if (s.kind === "extract") {
    const o = s.output as Omit<ExtractOutput, "claims"> & { dropped: string[]; claims: (ExtractOutput["claims"][number] & { introducedFacts?: string[] })[] };
    const none = !o.engagements.length && !o.capabilities.length && !o.claims.length;
    return (
      <Card>
        {head("Draft records from your text")}
        {none ? (
          <p className="text-sm text-ink-muted">Nothing could be extracted with a supporting quote.</p>
        ) : s.status === "pending" ? (
          <ActionForm action={approveSuggestionAction} aria-label="Choose drafts to add">
            <input type="hidden" name="suggestionId" value={s.id} />
            <p className="text-sm text-ink-muted">Each item shows the words it came from. Ticked items are added as private, self-reported drafts for you to review.</p>
            <fieldset className="space-y-2">
              <legend className="font-semibold">Choose what to add</legend>
              {o.engagements.map((e, i) => (
                <label key={`e${i}`} className="flex gap-3 rounded-lg border border-line p-3 text-sm">
                  <input type="checkbox" name="items" value={`engagement:${i}`} className="mt-1 h-4 w-4" />
                  <span><strong>Role or project:</strong> {e.title}<span className="block text-ink-soft">From: “{e.sourceQuote}”</span></span>
                </label>
              ))}
              {o.claims.map((c, i) => (
                <label key={`c${i}`} className="flex gap-3 rounded-lg border border-line p-3 text-sm">
                  <input type="checkbox" name="items" value={`claim:${i}`} className="mt-1 h-4 w-4" disabled={!!c.introducedFacts?.length} />
                  <span>
                    <strong>Claim:</strong> {c.text}
                    <span className="block text-ink-soft">From: “{c.sourceQuote}”</span>
                    {!!c.introducedFacts?.length && <span className="block font-semibold text-danger">Adds information not in your text ({c.introducedFacts.join("; ")}). Cannot be added.</span>}
                  </span>
                </label>
              ))}
              {o.capabilities.map((c, i) => (
                <div key={`k${i}`} className="flex flex-wrap items-center gap-3 rounded-lg border border-line p-3 text-sm">
                  <label className="flex flex-1 gap-3">
                    <input type="checkbox" name="items" value={`capability:${i}`} className="mt-1 h-4 w-4" />
                    <span><strong>Capability:</strong> {c.name}<span className="block text-ink-soft">From: “{c.sourceQuote}”</span></span>
                  </label>
                  <SelectField name={`level:capability:${i}`} label="Your level" options={proficiencyLevels} placeholder="Choose your level" className="w-48" />
                </div>
              ))}
            </fieldset>
            <SubmitButton>Add selected drafts</SubmitButton>
          </ActionForm>
        ) : null}
        {o.dropped.length > 0 && <p className="mt-3 text-sm text-ink-muted">Left out because they were not supported by your text: {o.dropped.join(", ")}.</p>}
        <div className="mt-3">{s.status === "pending" ? <InlineAction action={rejectSuggestionAction} hidden={{ suggestionId: s.id }}>Dismiss</InlineAction> : <Decide s={s} />}</div>
      </Card>
    );
  }

  if (s.kind === "follow_up") {
    const o = s.output as { questions: { question: string }[]; engagementTitle: string };
    return (
      <Card>
        {head(`Questions about “${o.engagementTitle}”`)}
        {o.questions.length ? <ul className="list-disc space-y-1 pl-5">{o.questions.map((q) => <li key={q.question}>{q.question}</li>)}</ul> : <p className="text-sm text-ink-muted">No questions: the record looks clear.</p>}
        <p className="mt-3 text-sm"><a href={`/talent/portfolio/${s.targetId}`}>Answer them in the project record</a></p>
        <div className="mt-3"><Decide s={s} approveLabel="Mark as reviewed" /></div>
      </Card>
    );
  }
  return null;
}

export default async function AssistantPage() {
  const actor = await requireTalent();
  const status = aiStatus();
  const [view, suggestions] = await Promise.all([buildProfileView(await getOwnProfile(actor), { kind: "owner" }), listSuggestions(actor, { kinds: ["summary", "rewrite", "extract", "follow_up"] })]);
  const targets = [
    ...(view.introduction ? [{ value: "introduction", label: "Professional introduction" }] : []),
    ...view.engagements.flatMap((e) =>
      (["individualActions", "outcomes", "context", "lessons"] as const).filter((f) => e[f]).map((f) => ({ value: `engagement:${e.id}:${f}`, label: `${e.title}: ${{ individualActions: "what you did", outcomes: "outcomes", context: "context", lessons: "lessons" }[f]}` })),
    ),
    ...[...view.engagements.flatMap((e) => e.claims), ...view.standaloneClaims].map((c) => ({ value: `claim:${c.id}`, label: `Claim: ${c.text.slice(0, 60)}` })),
  ];
  const off = status.mode === "off";
  return (
    <div className="space-y-8">
      <PageHeader title="Assistant" description="Help with summaries, clearer wording, drafting records and spotting gaps. It works only from your own records, and nothing is saved until you approve it." />
      <Alert tone={status.mode === "live" ? "info" : "warning"} title={status.mode === "live" ? "AI assistance is on" : status.mode === "demo" ? "Demonstration responses" : "AI assistance is off"}>
        {status.description} The assistant never verifies claims, contacts references or makes decisions about you.
      </Alert>
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <h2 className="text-xl">Summarise my profile</h2>
          <p className="mt-1 text-sm text-ink-muted">A short summary of what employers would see, with a source for each sentence.</p>
          <div className="mt-3">{off ? <p className="text-sm text-ink-soft">Unavailable while AI is off.</p> : <InlineAction action={summariseAction} variant="secondary" pendingLabel="Summarising…">Summarise</InlineAction>}</div>
        </Card>
        <Card>
          <h2 className="text-xl">Suggest clearer wording</h2>
          {targets.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">Write an introduction, project or claim first.</p>
          ) : off ? (
            <p className="mt-2 text-sm text-ink-soft">Unavailable while AI is off.</p>
          ) : (
            <ActionForm action={rewriteAction} className="mt-3" aria-label="Suggest clearer wording">
              <SelectField name="target" label="What to reword" required options={targets} defaultValue={targets[0].value} />
              <SubmitButton variant="secondary" pendingLabel="Thinking…">Suggest wording</SubmitButton>
            </ActionForm>
          )}
        </Card>
        <Card>
          <h2 className="text-xl">Draft records from text</h2>
          <p className="mt-1 text-sm text-ink-muted">Paste part of a CV or a description of your work. The text is used for this request only and is not stored.</p>
          {off ? (
            <p className="mt-2 text-sm text-ink-soft">Unavailable while AI is off. You can add records directly in your Evidence Portfolio.</p>
          ) : (
            <ActionForm action={extractAction} className="mt-3" aria-label="Draft records from text">
              <TextAreaField name="text" label="Your text" required rows={6} maxLength={8000} />
              <SubmitButton variant="secondary" pendingLabel="Reading…">Draft records</SubmitButton>
            </ActionForm>
          )}
          <p className="mt-2 text-xs text-ink-soft">Reading uploaded PDFs automatically is not available in this version.</p>
        </Card>
        <Card>
          <h2 className="text-xl">Questions about a project</h2>
          {view.engagements.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">Add a project first.</p>
          ) : off ? (
            <p className="mt-2 text-sm text-ink-soft">Unavailable while AI is off. The automatic checks on your dashboard still work.</p>
          ) : (
            <ActionForm action={followUpAction} className="mt-3" aria-label="Questions about a project">
              <SelectField name="engagementId" label="Project" required options={view.engagements.map((e) => ({ value: e.id, label: e.title }))} defaultValue={view.engagements[0].id} />
              <SubmitButton variant="secondary" pendingLabel="Thinking…">Ask questions</SubmitButton>
            </ActionForm>
          )}
        </Card>
      </div>
      <section aria-labelledby="sugg-h" className="space-y-4">
        <h2 id="sugg-h" className="text-2xl">Suggestions</h2>
        {suggestions.length === 0 ? <EmptyState title="No suggestions yet" /> : suggestions.map((s) => <SuggestionCard key={s.id} s={s} />)}
      </section>
    </div>
  );
}
