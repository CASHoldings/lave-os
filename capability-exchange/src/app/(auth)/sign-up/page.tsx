import Link from "next/link";
import type { Metadata } from "next";
import { ActionForm, RadioGroup, SubmitButton, TextField } from "@/components/forms";
import { brand } from "@/config/brand";
import { registerAction } from "../actions";

export const metadata: Metadata = { title: "Create an account" };

export default async function SignUpPage({ searchParams }: PageProps<"/sign-up">) {
  const { as } = await searchParams;
  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-3xl">Create your account</h1>
      <p className="mt-2 text-ink-muted">
        Your profile starts private. Nothing is shared with employers until you choose to share it.
      </p>
      <div className="mt-8 rounded-[var(--radius-card)] border border-line bg-surface p-6">
        <ActionForm action={registerAction} aria-label="Create an account">
          <RadioGroup
            name="accountType"
            label="How will you use the platform?"
            required
            defaultValue={as === "employer" ? "employer" : "talent"}
            options={[
              { value: "talent", label: "As a professional", help: `Build your ${brand.modules.profile.name} and find opportunities.` },
              { value: "employer", label: "As an employer or project owner", help: "Publish opportunities and find people. Organisations are reviewed before talent search opens." },
            ]}
          />
          <TextField name="displayName" label="Your name" required autoComplete="name" />
          <TextField name="email" label="Email address" type="email" required autoComplete="email" inputMode="email" />
          <TextField name="password" label="Password" type="password" required autoComplete="new-password" hint="At least 12 characters. A short phrase is easier to remember." />
          <SubmitButton pendingLabel="Creating account…" className="w-full">
            Create account
          </SubmitButton>
        </ActionForm>
      </div>
      <p className="mt-6 text-sm text-ink-muted">
        Already have an account? <Link href="/sign-in">Sign in</Link>
      </p>
    </div>
  );
}
