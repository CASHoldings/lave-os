import type { Metadata } from "next";
import { requireAdmin } from "@/server/auth/current";
import { getProfileForAdmin } from "@/server/services/admin";
import { notFoundOnAppError } from "@/server/page-helpers";
import { ProfileDocument } from "@/components/profile-document";
import { Alert, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Profile (administrator view)" };

export default async function AdminProfilePage({ params }: PageProps<"/admin/profiles/[id]">) {
  const { id } = await params;
  const actor = await requireAdmin();
  const view = await notFoundOnAppError(() => getProfileForAdmin(actor, id));
  return (
    <div>
      <PageHeader title={view.fullName} description="Administrator view for moderation. This view has been recorded in the audit log." />
      <Alert tone="info" className="mb-6">Administrators cannot edit profile content. Use reports to restrict access where needed.</Alert>
      <ProfileDocument view={view} ctx={{ kind: "live" }} />
    </div>
  );
}
