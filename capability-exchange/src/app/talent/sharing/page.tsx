import Link from "next/link";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { requireTalent } from "@/server/auth/current";
import { getOwnProfile } from "@/server/services/profile";
import { listGrants, listIntroductionRequests, listShareLinks } from "@/server/services/sharing";
import { InlineAction } from "@/components/forms";
import { Badge, Card, EmptyState, PageHeader, VisibilityBadge, formatDate } from "@/components/ui";
import { getEnv } from "@/config/env";
import { createShareLinkAction, respondIntroductionAction, revokeGrantAction, revokeShareLinkAction } from "../actions";
import { ShareLinkForm } from "./share-link-form";

export const metadata: Metadata = { title: "Sharing" };

const scopeLabel = { contact: "Contact details", evidence: "Evidence files", references: "Reference contact details" } as const;

export default async function SharingPage() {
  const actor = await requireTalent();
  const [profile, links, grants, intros] = await Promise.all([getOwnProfile(actor), listShareLinks(actor), listGrants(actor), listIntroductionRequests(actor)]);
  const h = await headers();
  const origin = h.get("host") ? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}` : getEnv().APP_URL;
  const now = Date.now();

  return (
    <div className="space-y-10">
      <PageHeader title="Sharing and access" description="Everything that controls who can see your profile, in one place." />

      <Card>
        <h2 className="text-xl">Current settings</h2>
        <ul className="mt-3 space-y-2 text-sm">
          <li className="flex flex-wrap items-center gap-2">Profile: <VisibilityBadge visibility={profile.visibility} /></li>
          <li className="flex flex-wrap items-center gap-2">Contact details: <VisibilityBadge visibility={profile.contactVisibility} /></li>
          <li className="flex flex-wrap items-center gap-2">Evidence: <VisibilityBadge visibility={profile.evidenceVisibility} /></li>
          <li className="flex flex-wrap items-center gap-2">Compensation: <VisibilityBadge visibility={profile.compensationVisibility} /></li>
        </ul>
        <Link href="/talent/profile#sharing" className="mt-3 inline-block text-sm font-semibold">
          Change these settings
        </Link>
      </Card>

      <section id="introductions" aria-labelledby="intro-h">
        <h2 id="intro-h" className="text-2xl">
          Introduction requests
        </h2>
        <p className="mt-1 text-sm text-ink-muted">Accepting shares your contact details with that organisation only. You can withdraw it later below.</p>
        {intros.length === 0 ? (
          <div className="mt-4">
            <EmptyState title="No introduction requests" />
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {intros.map(({ request, organisationName, opportunityTitle }) => (
              <Card as="li" key={request.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">
                    {organisationName}
                    {opportunityTitle && <span className="font-normal text-ink-muted"> · about “{opportunityTitle}”</span>}
                  </p>
                  <Badge tone={request.status === "pending" ? "info" : request.status === "accepted" ? "success" : "neutral"}>{request.status}</Badge>
                </div>
                <p className="mt-2 whitespace-pre-line text-sm">{request.message}</p>
                <p className="mt-1 text-xs text-ink-soft">Received {formatDate(request.createdAt)}</p>
                {request.status === "pending" && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <InlineAction action={respondIntroductionAction} hidden={{ requestId: request.id, decision: "accept" }} variant="primary">
                      Accept and share contact details
                    </InlineAction>
                    <InlineAction action={respondIntroductionAction} hidden={{ requestId: request.id, decision: "decline" }}>
                      Decline
                    </InlineAction>
                  </div>
                )}
              </Card>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="grants-h">
        <h2 id="grants-h" className="text-2xl">
          Organisations with extra access
        </h2>
        {grants.length === 0 ? (
          <div className="mt-4">
            <EmptyState title="No organisation has extra access" />
          </div>
        ) : (
          <ul className="mt-4 space-y-2">
            {grants.map(({ grant, organisationName }) => (
              <Card as="li" key={grant.id} className="flex flex-wrap items-center justify-between gap-3 !py-4">
                <span>
                  <strong>{organisationName}</strong> can see your {scopeLabel[grant.scope].toLowerCase()} (since {formatDate(grant.grantedAt)})
                </span>
                <InlineAction action={revokeGrantAction} hidden={{ grantId: grant.id }} confirm={`Withdraw ${organisationName}'s access?`}>
                  Withdraw
                </InlineAction>
              </Card>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="links-h" className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div>
          <h2 id="links-h" className="text-2xl">
            Share links
          </h2>
          <p className="mt-1 text-sm text-ink-muted">Anyone with a link can view the chosen version of your profile until it expires or you revoke it, even if your profile is private.</p>
          {links.length === 0 ? (
            <div className="mt-4">
              <EmptyState title="No share links yet" />
            </div>
          ) : (
            <ul className="mt-4 space-y-2">
              {links.map((l) => {
                const status = l.revokedAt ? "Revoked" : l.expiresAt.getTime() <= now ? "Expired" : "Active";
                return (
                  <Card as="li" key={l.id}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold">{l.label}</p>
                      <Badge tone={status === "Active" ? "success" : "neutral"}>{status}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-ink-muted">
                      {status === "Active" ? `Expires ${formatDate(l.expiresAt)}` : status === "Revoked" ? `Revoked ${formatDate(l.revokedAt)}` : `Expired ${formatDate(l.expiresAt)}`} · opened {l.accessCount} time{l.accessCount === 1 ? "" : "s"}
                      {l.includeContact && " · includes contact details"}
                      {l.includeEvidence && " · includes shareable evidence"}
                    </p>
                    {status === "Active" && (
                      <div className="mt-2">
                        <InlineAction action={revokeShareLinkAction} hidden={{ linkId: l.id }} confirm="Revoke this link? It will stop working immediately.">
                          Revoke link
                        </InlineAction>
                      </div>
                    )}
                  </Card>
                );
              })}
            </ul>
          )}
        </div>
        <Card className="lg:self-start">
          <h3 className="text-lg">Create a share link</h3>
          <div className="mt-3">
            <ShareLinkForm action={createShareLinkAction} origin={origin} />
          </div>
        </Card>
      </section>
    </div>
  );
}
