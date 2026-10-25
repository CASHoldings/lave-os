import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { brand } from "@/config/brand";
import { getCurrentActor } from "@/server/auth/current";
import { isDemoMode } from "@/config/env";
import { SiteHeader } from "@/components/site-header";

// Every page depends on who is signed in; nothing is pre-rendered with user data at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: brand.name, template: `%s · ${brand.name}` },
  description: `${brand.tagline} ${brand.positioning}`,
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const actor = await getCurrentActor();
  const demo = isDemoMode();
  return (
    <html lang="en-GB">
      <body>
        <a href="#main" className="skip-link">
          Skip to main content
        </a>
        {demo && (
          <div className="bg-warning-soft px-4 py-2 text-center text-sm text-warning" role="note">
            <strong>Demonstration mode.</strong> All people, organisations and records are fictional. Demo sign-in is available on this local build only.
          </div>
        )}
        <SiteHeader actor={actor} />
        <main id="main" className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
          {children}
        </main>
        <footer className="mt-16 border-t border-line">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-sm text-ink-muted sm:flex-row sm:justify-between sm:px-6">
            <p>
              {brand.name}. {brand.workingNameNotice}
            </p>
            <p className="flex gap-4">
              <Link href="/privacy">Privacy and data</Link>
              <Link href="/how-it-works">How evidence and matching work</Link>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
