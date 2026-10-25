import { auditEvents } from "@/server/db/schema";
import type { DbOrTx } from "@/server/db/client";
import { getDb } from "@/server/db/client";

export interface AuditInput {
  actorUserId: string | null;
  actorRole?: string;
  action: string;
  targetType?: string;
  targetId?: string | null;
  organisationId?: string | null;
  reason?: string | null;
  /** Identifiers and categorical values only. Never names, emails or profile text. */
  metadata?: Record<string, string | number | boolean | null | string[]>;
}

const ALLOWED_METADATA_KEY = /^(status|from|to|decision|method|scope|kind|count|fields|provider|task|visibility|grant|source|includeContact|includeEvidence|expiresAt|opportunityId|applicationId|profileId|evidenceId|claimId|shortlistId|reportId|organisationId|suggestionId|result|role)$/;

export async function audit(input: AuditInput, db: DbOrTx = getDb()) {
  const metadata = Object.fromEntries(Object.entries(input.metadata ?? {}).filter(([k]) => ALLOWED_METADATA_KEY.test(k)));
  await db.insert(auditEvents).values({
    actorUserId: input.actorUserId,
    actorRole: input.actorRole ?? null,
    action: input.action,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    organisationId: input.organisationId ?? null,
    reason: input.reason ?? null,
    metadata,
  });
}
