import Link from "next/link";
import type { Metadata } from "next";
import { requireActor } from "@/server/auth/current";
import { ActionForm, SubmitButton, TextField } from "@/components/forms";
import { Card, DefinitionRow, PageHeader, buttonClass } from "@/components/ui";
import { getEnv } from "@/config/env";
import { deleteAccountAction } from "./actions";

export const metadata: Metadata = { title: "Privacy and account" };

export default async function SettingsPage() {
  const actor = await requireActor("/settings");
  const env = getEnv();
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Privacy and account" description={<>How your data is handled is explained on the <Link href="/privacy">privacy page</Link>.</>} />
      <Card>
        <h2 className="text-xl">Account</h2>
        <dl className="mt-3">
          <DefinitionRow term="Name">{actor.displayName}</DefinitionRow>
          <DefinitionRow term="Email">{actor.email}</DefinitionRow>
          <DefinitionRow term="Account type">{actor.accountType === "talent" ? "Professional" : "Employer"}{actor.isAdmin && " · Platform administrator"}</DefinitionRow>
          <DefinitionRow term="Sign-in">{actor.isDemo ? "Fictional demo account (no password)" : env.AUTH_PROVIDER === "supabase" ? "Managed by Supabase Auth" : "Email and password"}</DefinitionRow>
        </dl>
        {actor.profileId && (
          <p className="mt-3 text-sm">
            Profile visibility and sharing: <Link href="/talent/sharing">Sharing and access</Link>
          </p>
        )}
      </Card>
      <Card>
        <h2 className="text-xl">Download your data</h2>
        <p className="mt-2 text-ink-muted">A JSON file with your account, profile, records, applications and the copies of your profile you shared, assistant suggestions and sharing history. Evidence files are listed; download each one from your evidence library.</p>
        <a href="/api/account/export" className={buttonClass("secondary", "mt-4")} download>
          Download my data
        </a>
      </Card>
      <Card className="border-danger/40">
        <h2 className="text-xl text-danger">Delete your account</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-muted">
          <li>Deletes your profile, records, evidence files, any text derived from them, share links, permissions and your search entry, immediately and permanently.</li>
          <li>Organisations you applied to keep only an anonymous record that an application was withdrawn, and their own notes.</li>
          <li>The audit record keeps event types and dates without your name, email or profile content. Operator backups may hold data until they expire.</li>
        </ul>
        <ActionForm action={deleteAccountAction} className="mt-4" aria-label="Delete your account">
          <TextField name="confirmation" label="Type DELETE to confirm" required autoComplete="off" />
          <SubmitButton variant="danger" pendingLabel="Deleting…">
            Permanently delete my account
          </SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
