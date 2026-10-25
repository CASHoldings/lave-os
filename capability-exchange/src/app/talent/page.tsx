import Link from "next/link";
import type { Metadata } from "next";
import { and, count, eq } from "drizzle-orm";
import { requireTalent } from "@/server/auth/current";
import { coreSteps, getOwnProfile } from "@/server/services/profile";
import { buildProfileView } from "@/server/services/profile-view";
import { profileChecks } from "@/server/services/profile-checks";
import { listMyApplications } from "@/server/services/applications";
import { listIntroductionRequests } from "@/server/services/sharing";
import { getDb } from "@/server/db/client";
import { aiSuggestions } from "@/server/db/schema";
import { Alert, Badge, ButtonLink, Card, EmptyState, PageHeader, Progress, VisibilityBadge, formatDate } from "@/components/ui";
import { InlineAction } from "@/components/forms";
import { applicationStatuses, labelOf } from "@/config/taxonomy";
import { brand } from "@/config/brand";
import { confirmProfileAction } from "./actions";

export const metadata: Metadata = { title: "Dashboard" };

export default async function TalentDashboard() {
  const actor = await requireTalent();
  const profile = await getOwnProfile(actor);
  const [steps, view, apps, intros, [{ pending }]] = await Promise.all([
    coreSteps(profile),
    buildProfileView(profile, { kind: "owner" }),
    listMyApplications(actor),
    listIntroductionRequests(actor),
    getDb().select({ pending: count() }).from(aiSuggestions).where(and(eq(aiSuggestions.userId, actor.userId), eq(aiSuggestions.status, "pending"))),
  ]);
  const checks = profileChecks(view);
  const done = steps.filter((s) => s.done).length;
  const nextStep = steps.find((s) => !s.done);
  const pendingIntros = intros.filter((i) => i.request.status === "pending");
  const resume = profile.lastEditedSection?.startsWith("module:") ? `/talent/profile/modules/${profile.lastEditedSection.slice(7)}` : profile.lastEditedSection ? `/talent/profile#${profile.lastEditedSection}` : "/talent/profile";

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Dashboard"
        title={`Welcome back, ${view.preferredName || view.fullName.split(" ")[0] || "there"}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            Your profile is <VisibilityBadge visibility={profile.visibility} />
            {profile.coreCompletedAt ? <Badge tone="success">Core profile complete</Badge> : <Badge tone="warning">Draft</Badge>}
          </span>
        }
        actions={
          <>
            <ButtonLink href={resume}>Continue where you left off</ButtonLink>
            <ButtonLink href="/talent/profile/preview" variant="secondary">
              Preview
            </ButtonLink>
          </>
        }
      />

      {pendingIntros.length > 0 && (
        <Alert tone="info" title={`${pendingIntros.length} introduction request${pendingIntros.length > 1 ? "s" : ""} waiting for you`}>
          <Link href="/talent/sharing#introductions">Review requests</Link>. Your contact details are only shared if you accept.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="text-xl">Core profile</h2>
          <div className="mt-4">
            <Progress value={done / steps.length} label={`${done} of ${steps.length} steps`} />
          </div>
          {nextStep ? (
            <p className="mt-4">
              Next: <Link href={nextStep.href}>{nextStep.label}</Link>
            </p>
          ) : (
            <p className="mt-4 text-ink-muted">Your core profile is complete. Add depth with the optional modules when it is useful.</p>
          )}
          <div className="mt-4 flex flex-wrap gap-3">
            <InlineAction action={confirmProfileAction} variant="secondary" pendingLabel="Saving…">
              My profile is up to date
            </InlineAction>
          </div>
          <p className="mt-2 text-xs text-ink-soft">{profile.lastConfirmedAt ? `Last confirmed ${formatDate(profile.lastConfirmedAt)}.` : "Never confirmed."}</p>
        </Card>
        <Card>
          <h2 className="text-xl">At a glance</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <Link href="/talent/portfolio">{view.engagements.length} projects and roles</Link>
            </li>
            <li>
              <Link href="/talent/capabilities">{view.capabilities.length} capabilities</Link>
            </li>
            <li>
              <Link href="/talent/portfolio/evidence">{view.evidence.length} evidence items</Link>
            </li>
            <li>
              <Link href="/talent/assistant">{pending} assistant suggestion{pending === 1 ? "" : "s"} to review</Link>
            </li>
          </ul>
        </Card>
      </div>

      <section aria-labelledby="checks-h">
        <h2 id="checks-h" className="text-2xl">
          Questions that would strengthen your profile
        </h2>
        <p className="mt-1 text-sm text-ink-muted">Automatic checks based on what you have written. They only ask; nothing changes unless you edit.</p>
        {checks.length === 0 ? (
          <div className="mt-4">
            <EmptyState title="No open questions">Your records are clear and specific. Nice work.</EmptyState>
          </div>
        ) : (
          <ul className="mt-4 grid gap-3 md:grid-cols-2">
            {checks.slice(0, 6).map((c) => (
              <Card as="li" key={c.id}>
                <p>{c.question}</p>
                <p className="mt-1 text-sm text-ink-muted">{c.why}</p>
                <Link href={c.href} className="mt-2 inline-block text-sm font-semibold">
                  Answer in your record
                </Link>
              </Card>
            ))}
          </ul>
        )}
        {checks.length > 6 && <p className="mt-2 text-sm text-ink-muted">{checks.length - 6} more on your Evidence Portfolio pages.</p>}
      </section>

      <section aria-labelledby="apps-h">
        <div className="flex items-end justify-between">
          <h2 id="apps-h" className="text-2xl">
            Applications
          </h2>
          <Link href="/opportunities" className="text-sm font-semibold">
            Browse {brand.modules.opportunities.name.toLowerCase()}
          </Link>
        </div>
        {apps.length === 0 ? (
          <div className="mt-4">
            <EmptyState title="No applications yet" action={<ButtonLink href="/opportunities">Explore opportunities</ButtonLink>}>
              When you apply, the organisation receives a fixed copy of the profile you approve.
            </EmptyState>
          </div>
        ) : (
          <ul className="mt-4 space-y-2">
            {apps.slice(0, 5).map((a) => (
              <Card as="li" key={a.application.id} className="flex flex-wrap items-center justify-between gap-2 !py-4">
                <Link href={`/talent/applications/${a.application.id}`}>
                  {a.opportunity.title} · {a.organisationName}
                </Link>
                <Badge tone={a.application.status === "withdrawn" || a.application.status === "not_progressing" ? "neutral" : "accent"}>{labelOf(applicationStatuses, a.application.status)}</Badge>
              </Card>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
