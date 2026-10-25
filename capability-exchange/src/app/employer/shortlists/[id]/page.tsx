import Link from "next/link";
import type { Metadata } from "next";
import { requireDiscoveryAccess } from "@/server/auth/current";
import { getShortlist } from "@/server/services/applications";
import { notFoundOnAppError } from "@/server/page-helpers";
import { ActionForm, InlineAction, SubmitButton, TextAreaField } from "@/components/forms";
import { Badge, Card, EmptyState, PageHeader, formatDate } from "@/components/ui";
import { deleteShortlistAction, removeFromShortlistAction, shortlistNoteAction } from "../../actions";

export const metadata: Metadata = { title: "Shortlist" };

export default async function ShortlistPage({ params }: PageProps<"/employer/shortlists/[id]">) {
  const { id } = await params;
  const actor = await requireDiscoveryAccess();
  const { list, entries } = await notFoundOnAppError(() => getShortlist(actor, id));
  return (
    <div>
      <PageHeader title={list.name} description={list.description} actions={<Link href="/employer/shortlists">← All shortlists</Link>} />
      {entries.length === 0 ? (
        <EmptyState title="Nobody on this shortlist yet" />
      ) : (
        <ul className="space-y-3">
          {entries.map(({ entry, view }) => (
            <Card as="li" key={entry.id}>
              {view ? (
                <>
                  <Link href={`/employer/talent/${view.id}${list.opportunityId ? `?opportunity=${list.opportunityId}` : ""}`} className="text-lg font-semibold">{view.preferredName || view.fullName}</Link>
                  <p className="text-ink-muted">{view.headline}</p>
                </>
              ) : (
                <p className="text-ink-muted"><Badge>No longer visible</Badge> This person has made their profile private. The entry is kept for your records.</p>
              )}
              <p className="mt-1 text-xs text-ink-soft">Added {formatDate(entry.createdAt)}</p>
              <ActionForm action={shortlistNoteAction} className="mt-3" aria-label="Shortlist note">
                <input type="hidden" name="entryId" value={entry.id} />
                <TextAreaField name="note" label="Private note" rows={2} defaultValue={entry.note} />
                <SubmitButton variant="secondary">Save note</SubmitButton>
              </ActionForm>
              <div className="mt-2">
                <InlineAction action={removeFromShortlistAction} hidden={{ entryId: entry.id }} variant="ghost">Remove</InlineAction>
              </div>
            </Card>
          ))}
        </ul>
      )}
      <div className="mt-8">
        <InlineAction action={deleteShortlistAction} hidden={{ shortlistId: list.id }} variant="danger" confirm="Delete this shortlist and its notes?">Delete shortlist</InlineAction>
      </div>
    </div>
  );
}
