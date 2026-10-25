import Link from "next/link";
import type { Metadata } from "next";
import { requireTalent } from "@/server/auth/current";
import { getOwnProfile } from "@/server/services/profile";
import { buildProfileView } from "@/server/services/profile-view";
import { ProfileDocument } from "@/components/profile-document";
import { Alert, PageHeader, cx } from "@/components/ui";
import type { Audience } from "@/server/policy/profile-access";

export const metadata: Metadata = { title: "Preview your profile" };

const modes = [
  { key: "owner", label: "As you see it" },
  { key: "employer", label: "As an approved employer" },
  { key: "share", label: "Through a share link" },
] as const;

export default async function PreviewPage({ searchParams }: PageProps<"/talent/profile/preview">) {
  const actor = await requireTalent();
  const sp = await searchParams;
  const mode = modes.find((m) => m.key === sp.as)?.key ?? "employer";
  const profile = await getOwnProfile(actor);
  const audience: Audience =
    mode === "owner"
      ? { kind: "owner" }
      : mode === "share"
        ? { kind: "share", includeContact: sp.contact === "1", includeEvidence: sp.evidence === "1" }
        : { kind: "employer", organisationId: "preview", grants: [] };
  const view = await buildProfileView(profile, audience);

  return (
    <div>
      <PageHeader title="Preview" description="See exactly what each audience sees. Private items are left out of the other views." />
      <nav aria-label="Preview as" className="mb-6 flex flex-wrap gap-2">
        {modes.map((m) => (
          <Link
            key={m.key}
            href={`/talent/profile/preview?as=${m.key}`}
            aria-current={m.key === mode ? "page" : undefined}
            className={cx("rounded-full border px-4 py-2 text-sm font-semibold no-underline", m.key === mode ? "border-accent bg-accent text-white" : "border-line-strong bg-surface text-ink")}
          >
            {m.label}
          </Link>
        ))}
      </nav>
      {mode === "employer" && profile.visibility === "private" && (
        <Alert tone="warning" className="mb-6" title="Your profile is private">
          Employers cannot find or open it. This is what they would see if you made it discoverable in your <Link href="/talent/profile#sharing">sharing settings</Link>. Contact details appear only to organisations whose introduction you accept, unless you choose otherwise.
        </Alert>
      )}
      {mode === "share" && (
        <Alert tone="info" className="mb-6">
          Share links can include contact details and shareable evidence if you choose.{" "}
          <Link href={`/talent/profile/preview?as=share&contact=1&evidence=1`}>Preview with both</Link> · <Link href="/talent/profile/preview?as=share">without</Link>
        </Alert>
      )}
      <ProfileDocument view={view} ctx={mode === "owner" ? { kind: "live" } : { kind: "none" }} />
    </div>
  );
}
