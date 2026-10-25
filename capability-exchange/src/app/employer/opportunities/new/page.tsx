import type { Metadata } from "next";
import { requireEmployer } from "@/server/auth/current";
import { OpportunityForm } from "@/components/opportunity-form";
import { Card, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "New opportunity" };

export default async function NewOpportunityPage() {
  await requireEmployer();
  return (
    <div className="max-w-3xl">
      <PageHeader title="New opportunity" description="Saved as a draft. Add requirements next, then publish when ready." />
      <Card>
        <OpportunityForm />
      </Card>
    </div>
  );
}
