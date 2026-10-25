import Link from "next/link";
import { brand } from "@/config/brand";
import type { Actor } from "@/server/policy/actor";
import { signOutAction } from "@/app/(auth)/actions";

type NavItem = { href: string; label: string };

export function navFor(actor: Actor | null): NavItem[] {
  if (!actor) return [];
  const items: NavItem[] = [];
  if (actor.profileId) {
    items.push(
      { href: "/talent", label: "Dashboard" },
      { href: "/talent/profile", label: brand.modules.profile.name },
      { href: "/talent/portfolio", label: brand.modules.evidence.name },
      { href: "/opportunities", label: brand.modules.opportunities.name },
      { href: "/talent/applications", label: "Applications" },
      { href: "/talent/sharing", label: "Sharing" },
      { href: "/talent/assistant", label: "Assistant" },
    );
  } else if (actor.memberships.length) {
    items.push(
      { href: "/employer", label: "Dashboard" },
      { href: "/employer/opportunities", label: "Opportunities" },
      { href: "/employer/search", label: "Find talent" },
      { href: "/employer/shortlists", label: "Shortlists" },
      { href: "/employer/team", label: "Organisation" },
    );
  } else if (actor.accountType === "employer") {
    items.push({ href: "/employer/onboarding", label: "Set up your organisation" });
  }
  if (actor.isAdmin) items.push({ href: "/admin", label: "Administration" });
  items.push({ href: "/settings", label: "Settings" });
  return items;
}

export function SiteHeader({ actor }: { actor: Actor | null }) {
  const items = navFor(actor);
  return (
    <header className="border-b border-line bg-surface/90">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href={actor ? (actor.profileId ? "/talent" : actor.isAdmin && !actor.memberships.length ? "/admin" : "/employer") : "/"} className="flex items-center gap-2 no-underline">
          <span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-lg bg-ink font-serif text-lg font-bold text-white">
            {brand.shortName.slice(0, 1)}
          </span>
          <span className="font-serif text-lg font-semibold leading-tight text-ink">{brand.name}</span>
        </Link>
        {actor ? (
          <>
            <nav aria-label="Main" className="hidden lg:block">
              <ul className="flex flex-wrap items-center gap-1 text-sm">
                {items.map((i) => (
                  <li key={i.href}>
                    <Link href={i.href} className="rounded-md px-2.5 py-2 font-medium text-ink no-underline hover:bg-surface-muted">
                      {i.label}
                    </Link>
                  </li>
                ))}
                <li>
                  <form action={signOutAction}>
                    <button className="rounded-md px-2.5 py-2 font-medium text-ink-muted hover:bg-surface-muted">Sign out</button>
                  </form>
                </li>
              </ul>
            </nav>
            <details className="relative lg:hidden">
              <summary className="cursor-pointer list-none rounded-lg border border-line-strong px-3 py-2 text-sm font-semibold">Menu</summary>
              <nav aria-label="Main" className="absolute right-0 z-20 mt-2 w-64 rounded-lg border border-line bg-surface p-2 shadow-lg">
                <ul className="text-sm">
                  {items.map((i) => (
                    <li key={i.href}>
                      <Link href={i.href} className="block rounded-md px-3 py-2.5 text-ink no-underline hover:bg-surface-muted">
                        {i.label}
                      </Link>
                    </li>
                  ))}
                  <li>
                    <form action={signOutAction}>
                      <button className="block w-full rounded-md px-3 py-2.5 text-left text-ink-muted hover:bg-surface-muted">Sign out</button>
                    </form>
                  </li>
                </ul>
              </nav>
            </details>
          </>
        ) : (
          <nav aria-label="Account" className="flex items-center gap-2 text-sm">
            <Link href="/sign-in" className="rounded-md px-3 py-2 font-semibold text-ink no-underline hover:bg-surface-muted">
              Sign in
            </Link>
            <Link href="/sign-up" className="rounded-lg bg-accent px-3 py-2 font-semibold text-white no-underline hover:bg-accent-strong">
              Create account
            </Link>
          </nav>
        )}
      </div>
    </header>
  );
}
