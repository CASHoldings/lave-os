import Link from "next/link";
import { requireAdmin } from "@/server/auth/current";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div>
      <nav aria-label="Administration" className="mb-8 flex flex-wrap gap-2 border-b border-line pb-4 text-sm">
        {[
          ["/admin", "Overview"],
          ["/admin/organisations", "Employer registrations"],
          ["/admin/verification", "Verification"],
          ["/admin/reports", "Reports"],
          ["/admin/audit", "Audit record"],
        ].map(([href, label]) => (
          <Link key={href} href={href} className="rounded-md px-3 py-2 font-semibold text-ink no-underline hover:bg-surface-muted">{label}</Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
