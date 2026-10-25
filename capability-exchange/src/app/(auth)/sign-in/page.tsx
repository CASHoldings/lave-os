import Link from "next/link";
import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { ActionForm, SubmitButton, TextField } from "@/components/forms";
import { Alert, Badge } from "@/components/ui";
import { isDemoMode } from "@/config/env";
import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { demoSignInAction, signInAction } from "../actions";
import { DemoPersonaButton } from "./demo-persona";

export const metadata: Metadata = { title: "Sign in" };

const personaNotes: Record<string, string> = {
  efua: "Complete, discoverable profile with a verified claim",
  lindiwe: "New draft profile: try onboarding",
  samuel: "Complete but private profile",
  kofi: "Approved employer with opportunities and a shortlist",
  nomvula: "Approved employer reviewing applications",
  moussa: "Employer awaiting approval",
  reviewer: "Platform administrator",
};

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const { next } = await searchParams;
  const demo = isDemoMode();
  const personas = demo
    ? await getDb().select({ id: users.id, name: users.displayName, email: users.email, accountType: users.accountType, role: users.platformRole }).from(users).where(eq(users.isDemo, true)).orderBy(asc(users.accountType), asc(users.displayName))
    : [];
  return (
    <div className="mx-auto grid max-w-5xl gap-10 lg:grid-cols-2">
      <div>
        <h1 className="text-3xl">Sign in</h1>
        <div className="mt-8 rounded-[var(--radius-card)] border border-line bg-surface p-6">
          <ActionForm action={signInAction} aria-label="Sign in">
            <input type="hidden" name="next" value={typeof next === "string" ? next : ""} />
            <TextField name="email" label="Email address" type="email" required autoComplete="email" inputMode="email" />
            <TextField name="password" label="Password" type="password" required autoComplete="current-password" />
            <SubmitButton pendingLabel="Signing in…" className="w-full">
              Sign in
            </SubmitButton>
          </ActionForm>
          <p className="mt-4 text-sm text-ink-muted">
            Password reset needs an email service, which is not configured in this build. <span className="sr-only">Unavailable.</span>
          </p>
        </div>
        <p className="mt-6 text-sm text-ink-muted">
          New here? <Link href="/sign-up">Create an account</Link>
        </p>
      </div>
      {demo && (
        <section aria-labelledby="demo-heading">
          <h2 id="demo-heading" className="text-2xl">
            Demo sign-in
          </h2>
          <Alert tone="warning" className="mt-3">
            Local demonstration only. These fictional accounts have no passwords and this option does not exist in production builds.
          </Alert>
          {personas.length === 0 ? (
            <p className="mt-4 text-sm text-ink-muted">No demo data is loaded. Run <code>npm run demo:setup</code>.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {personas.map((p) => {
                const key = p.email.split("@")[0];
                return (
                  <li key={p.id}>
                    <DemoPersonaButton action={demoSignInAction} userId={p.id}>
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{p.name}</span>
                        <Badge tone={p.role === "admin" ? "info" : p.accountType === "talent" ? "accent" : "neutral"}>
                          {p.role === "admin" ? "Administrator" : p.accountType === "talent" ? "Professional" : "Employer"}
                        </Badge>
                      </span>
                      {personaNotes[key] && <span className="block text-sm text-ink-muted">{personaNotes[key]}</span>}
                    </DemoPersonaButton>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
