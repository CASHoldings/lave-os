import type { ReactNode } from "react";
import { ActionForm, InlineAction, SubmitButton } from "./forms";
import { Card, EmptyState, PageHeader, VisibilityBadge } from "./ui";
import { deleteRecordAction, saveRecordAction } from "@/app/talent/actions";

/** Shared layout for simple owned records: a list, an add form, and edit forms. */
export function RecordsPage<T extends { id: string; visibility: string }>({
  kind,
  title,
  eyebrow,
  description,
  items,
  renderItem,
  renderFields,
  emptyTitle,
  addLabel,
}: {
  kind: "learning" | "publicWork" | "referee";
  title: string;
  eyebrow: string;
  description: ReactNode;
  items: T[];
  renderItem: (item: T) => ReactNode;
  renderFields: (item?: T) => ReactNode;
  emptyTitle: string;
  addLabel: string;
}) {
  return (
    <div>
      <PageHeader eyebrow={eyebrow} title={title} description={description} />
      <div className="grid gap-8 lg:grid-cols-[1fr_24rem]">
        <div className="space-y-4">
          {items.length === 0 && <EmptyState title={emptyTitle} />}
          {items.map((item) => (
            <Card key={item.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>{renderItem(item)}</div>
                <VisibilityBadge visibility={item.visibility} />
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-semibold text-accent-strong">Edit</summary>
                <ActionForm action={saveRecordAction} className="mt-3" aria-label={`Edit ${title.toLowerCase()} entry`}>
                  <input type="hidden" name="recordKind" value={kind} />
                  <input type="hidden" name="recordId" value={item.id} />
                  {renderFields(item)}
                  <SubmitButton>Save changes</SubmitButton>
                </ActionForm>
              </details>
              <div className="mt-2">
                <InlineAction action={deleteRecordAction} hidden={{ recordKind: kind, recordId: item.id }} variant="ghost" confirm="Delete this entry?">
                  Delete
                </InlineAction>
              </div>
            </Card>
          ))}
        </div>
        <Card className="lg:sticky lg:top-6 lg:self-start">
          <h2 className="text-xl">{addLabel}</h2>
          <ActionForm action={saveRecordAction} className="mt-4" resetOnSuccess aria-label={addLabel}>
            <input type="hidden" name="recordKind" value={kind} />
            {renderFields()}
            <SubmitButton>Add</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </div>
  );
}
