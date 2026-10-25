import type { Metadata } from "next";
import { requireTalent } from "@/server/auth/current";
import { getOwnProfile } from "@/server/services/profile";
import { buildProfileView } from "@/server/services/profile-view";
import { EngagementForm } from "@/components/engagement-form";
import { Card, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Add a project or role" };

export default async function NewEngagementPage({ searchParams }: PageProps<"/talent/portfolio/new">) {
  const actor = await requireTalent();
  const { kind } = await searchParams;
  const view = await buildProfileView(await getOwnProfile(actor), { kind: "owner" });
  return (
    <div className="max-w-3xl">
      <PageHeader eyebrow="Evidence Portfolio" title="Add a project or role" description="Only the name is required. You can save now and add detail later, then add claims and evidence." />
      <Card>
        <EngagementForm kind={typeof kind === "string" ? kind : undefined} capabilities={view.capabilities} />
      </Card>
    </div>
  );
}
