import Link from "next/link";
import type { Metadata } from "next";
import { requireTalent } from "@/server/auth/current";
import { getOwnProfile } from "@/server/services/profile";
import { buildProfileView } from "@/server/services/profile-view";
import { Alert, Badge, ButtonLink, Card, EmptyState, PageHeader, VerificationBadge, VisibilityBadge, formatMonth } from "@/components/ui";
import { engagementKinds, engagementStages, labelOf } from "@/config/taxonomy";
import { brand } from "@/config/brand";

export const metadata: Metadata = { title: "Evidence Portfolio" };

export default async function PortfolioPage({ searchParams }: PageProps<"/talent/portfolio">) {
  const actor = await requireTalent();
  const { deleted } = await searchParams;
  const view = await buildProfileView(await getOwnProfile(actor), { kind: "owner" });
  const allClaims = [...view.engagements.flatMap((e) => e.claims), ...view.standaloneClaims];
  const counts = {
    self: allClaims.filter((c) => c.verificationStatus === "self_reported").length,
    evidence: allClaims.filter((c) => c.verificationStatus === "evidence_supplied").length,
    verified: allClaims.filter((c) => c.verificationStatus === "independently_verified").length,
  };
  return (
    <div>
      <PageHeader
        eyebrow={brand.modules.evidence.name}
        title="Projects, contributions and evidence"
        description={brand.modules.evidence.description}
        actions={
          <>
            <ButtonLink href="/talent/portfolio/evidence" variant="secondary">
              Evidence library ({view.evidence.length})
            </ButtonLink>
            <ButtonLink href="/talent/portfolio/new">Add project or role</ButtonLink>
          </>
        }
      />
      {deleted && <Alert tone="success" className="mb-6">Project deleted.</Alert>}
      <div className="mb-6 flex flex-wrap gap-3 text-sm" aria-label="Claims by evidence status">
        <span className="flex items-center gap-2"><VerificationBadge status="self_reported" /> {counts.self}</span>
        <span className="flex items-center gap-2"><VerificationBadge status="evidence_supplied" /> {counts.evidence}</span>
        <span className="flex items-center gap-2"><VerificationBadge status="independently_verified" /> {counts.verified}</span>
      </div>
      {view.engagements.length === 0 ? (
        <EmptyState title="No projects or roles yet" action={<ButtonLink href="/talent/portfolio/new">Add your first project</ButtonLink>}>
          Start with one piece of work you are proud of. You only need a name to begin.
        </EmptyState>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {view.engagements.map((e) => (
            <Card as="li" key={e.id}>
              <div className="flex flex-wrap gap-2">
                <Badge>{labelOf(engagementKinds, e.kind)}</Badge>
                {e.isSignature && <Badge tone="accent">Signature</Badge>}
                <VisibilityBadge visibility={e.visibility} />
              </div>
              <h2 className="mt-3 text-xl">
                <Link href={`/talent/portfolio/${e.id}`}>{e.title}</Link>
              </h2>
              <p className="text-sm text-ink-muted">{[e.roleTitle, e.organisationLabel].filter(Boolean).join(" · ")}</p>
              <p className="text-sm text-ink-soft">
                {[formatMonth(e.startDate), e.isCurrent ? "present" : formatMonth(e.endDate)].filter(Boolean).join(" to ")}
                {e.stageReached && ` · Stage reached: ${labelOf(engagementStages, e.stageReached)}`}
              </p>
              <p className="mt-3 text-sm">
                {e.claims.length} claim{e.claims.length === 1 ? "" : "s"} · {e.claims.filter((c) => c.verificationStatus !== "self_reported").length} with evidence or verification
              </p>
            </Card>
          ))}
        </ul>
      )}
      <p className="mt-8 text-sm text-ink-muted">
        Also part of your portfolio: <Link href="/talent/capabilities">capabilities</Link>, <Link href="/talent/learning">learning</Link>, <Link href="/talent/public-work">public work</Link> and{" "}
        <Link href="/talent/references">references</Link>.
      </p>
    </div>
  );
}
