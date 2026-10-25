import type { Metadata } from "next";
import { requireEmployer } from "@/server/auth/current";
import { getOwnOpportunity } from "@/server/services/employer";
import { OpportunityForm } from "@/components/opportunity-form";
import { Card, PageHeader } from "@/components/ui";
import { notFoundOnAppError } from "@/server/page-helpers";

export const metadata: Metadata = { title: "Edit opportunity" };

export default async function EditOpportunityPage({ params }: PageProps<"/employer/opportunities/[id]/edit">) {
  const { id } = await params;
  const actor = await requireEmployer();
  const o = await notFoundOnAppError(() => getOwnOpportunity(actor, id));
  return (
    <div className="max-w-3xl">
      <PageHeader title={`Edit: ${o.title}`} />
      <Card>
        <OpportunityForm o={o} />
      </Card>
    </div>
  );
}
