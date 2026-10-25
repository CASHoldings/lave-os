import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { viewSharedProfile } from "@/server/services/sharing";
import { ProfileDocument } from "@/components/profile-document";
import { Alert, formatDate } from "@/components/ui";

export const metadata: Metadata = { title: "Shared profile", referrer: "no-referrer" };

export default async function SharedProfilePage({ params }: PageProps<"/share/[token]">) {
  const { token } = await params;
  const shared = await viewSharedProfile(token);
  // Revoked, expired and unknown links are indistinguishable.
  if (!shared) notFound();
  return (
    <div>
      <Alert tone="info" className="mb-6">
        Shared by the profile owner. This link expires on {formatDate(shared.expiresAt)} and can be revoked at any time. Evidence labels show what supports each claim.
      </Alert>
      <ProfileDocument view={shared.view} ctx={shared.includeEvidence ? { kind: "share", token } : { kind: "none" }} />
    </div>
  );
}
