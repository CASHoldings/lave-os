import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireTalent } from "@/server/auth/current";
import { getOwnProfile } from "@/server/services/profile";
import { getDb } from "@/server/db/client";
import { moduleResponses } from "@/server/db/schema";
import { moduleByKey, motivationOptions, profileModules, type RoleFamily } from "@/config/taxonomy";
import { AutosaveForm } from "@/components/autosave-form";
import { RadioGroup, TextAreaField } from "@/components/forms";
import { Alert, ButtonLink, Card, PageHeader } from "@/components/ui";
import { saveModuleAnswerAction } from "../../../actions";

export default async function ModulePage({ params }: PageProps<"/talent/profile/modules/[module]">) {
  const { module: key } = await params;
  const mod = moduleByKey(key);
  if (!mod) notFound();
  const actor = await requireTalent();
  const profile = await getOwnProfile(actor);
  const answers = await getDb()
    .select()
    .from(moduleResponses)
    .where(and(eq(moduleResponses.profileId, profile.id), eq(moduleResponses.moduleKey, mod.key)));
  const idx = profileModules.findIndex((m) => m.key === mod.key);
  const prev = profileModules[idx - 1];
  const next = profileModules[idx + 1];

  return (
    <div className="max-w-3xl">
      <PageHeader eyebrow={`Module ${mod.number} of ${profileModules.length} · optional`} title={mod.title} description={mod.intro} />
      {mod.excludedFromMatching && (
        <Alert tone="info" className="mb-6">
          These answers can be shown to employers you approve, but they are never used to filter, rank or match you.
        </Alert>
      )}
      {mod.linkedRecords && (
        <div className="mb-6 flex flex-wrap gap-2">
          {mod.linkedRecords.map((l) => (
            <ButtonLink key={l.href} href={l.href} variant="secondary">
              {l.label}
            </ButtonLink>
          ))}
        </div>
      )}
      <div className="space-y-6">
        {mod.questions.map((q) => {
          const existing = answers.find((a) => a.questionKey === q.key);
          const roleHint = profile.roleFamily ? q.roleHints?.[profile.roleFamily as RoleFamily] : undefined;
          return (
            <Card key={q.key}>
              <AutosaveForm save={saveModuleAnswerAction} label={q.label} delay={1500}>
                <input type="hidden" name="moduleKey" value={mod.key} />
                <input type="hidden" name="questionKey" value={q.key} />
                {q.type === "scale" ? (
                  <RadioGroup
                    name="answer"
                    label={q.label}
                    hint={q.help}
                    defaultValue={existing?.answer}
                    options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))}
                  />
                ) : (
                  <TextAreaField
                    name="answer"
                    label={q.label}
                    rows={q.type === "ranking" ? 3 : 6}
                    defaultValue={existing?.answer}
                    maxLength={6000}
                    hint={
                      <>
                        {q.help}
                        {q.type === "ranking" && ` Options: ${motivationOptions.join(", ")}.`}
                        {roleHint && <span className="block">Prompt for your field: {roleHint}</span>}
                        {q.maxWords && <span className="block">Aim for up to {q.maxWords} words.</span>}
                      </>
                    }
                  />
                )}
                <RadioGroup
                  name="visibility"
                  label="Who can see this answer"
                  defaultValue={existing?.visibility ?? "approved_employers"}
                  options={[
                    { value: "approved_employers", label: "Anyone I share my profile with" },
                    { value: "private", label: "Only me" },
                  ]}
                />
              </AutosaveForm>
            </Card>
          );
        })}
        {mod.questions.length === 0 && (
          <Card>
            <p className="text-ink-muted">This module is built from structured records rather than written answers. Use the button above to manage them.</p>
          </Card>
        )}
      </div>
      <nav aria-label="Modules" className="mt-8 flex justify-between gap-4 text-sm">
        {prev ? <Link href={`/talent/profile/modules/${prev.key}`}>← {prev.title}</Link> : <Link href="/talent/profile">← Core profile</Link>}
        {next ? <Link href={`/talent/profile/modules/${next.key}`}>{next.title} →</Link> : <Link href="/talent/profile/preview">Preview your profile →</Link>}
      </nav>
    </div>
  );
}
