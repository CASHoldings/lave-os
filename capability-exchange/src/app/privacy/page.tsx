import type { Metadata } from "next";
import { PageHeader, Card } from "@/components/ui";

export const metadata: Metadata = { title: "Privacy and data" };

export default function PrivacyPage() {
  return (
    <div className="max-w-3xl">
      <PageHeader title="Privacy and data" description="How information is shown, stored and deleted. This is a product explanation, not a legal policy." />
      <div className="space-y-6">
        <Card>
          <h2 className="text-xl">Who can see a profile</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-ink-muted">
            <li>Profiles are private by default. Only the owner sees a private profile.</li>
            <li>An owner can make their profile visible to approved employers: organisations that a platform administrator has reviewed.</li>
            <li>Contact details, evidence, compensation and references each have their own setting. Reference contact details are never shown without explicit permission and the reference's consent.</li>
            <li>Share links show a chosen view to anyone holding the link, expire automatically, and can be revoked at any time.</li>
            <li>Applying to an opportunity shares a fixed copy (a snapshot) of the profile with that organisation. Later edits do not change it. Withdrawing the application ends the organisation's access to the snapshot and its files.</li>
            <li>Platform administrators can view profiles for moderation and verification. Those views and every file download by others are recorded.</li>
          </ul>
        </Card>
        <Card>
          <h2 className="text-xl">Files</h2>
          <p className="mt-3 text-ink-muted">
            Evidence files are kept in private storage. Each download needs a permission check and uses a link that stops working after one minute. Uploading a file never marks a claim as verified.
          </p>
        </Card>
        <Card>
          <h2 className="text-xl">Export and deletion</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-ink-muted">
            <li>You can download everything held about you as a file from Settings at any time.</li>
            <li>Deleting your account removes your profile, records, uploaded files, any text derived from them, share links, permissions, snapshots and your search entry.</li>
            <li>Organisations you applied to keep an anonymous record that an application existed and was withdrawn, plus their own notes.</li>
            <li>The audit record keeps event types, dates and internal identifiers (not your name, email or profile content) so actions on the platform remain accountable.</li>
            <li>Database backups, where an operator has configured them, may hold deleted data until they expire under the operator's retention schedule.</li>
          </ul>
        </Card>
        <Card>
          <h2 className="text-xl">AI assistance</h2>
          <p className="mt-3 text-ink-muted">
            When AI is switched on, only the information the requesting person is allowed to see is sent to the model, with contact details removed. Suggestions are stored as drafts and nothing changes on a profile until its owner approves it. AI never rejects applicants, verifies credentials or contacts references.
          </p>
        </Card>
      </div>
    </div>
  );
}
