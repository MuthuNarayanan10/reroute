import { auditLog } from '../db/schema.js';
import { db, type Tx } from '../db/client.js';

export async function audit(
  entry: {
    storeId?: string | null;
    actor: string;
    action: string;
    entity: string;
    entityId?: string | null;
    data?: Record<string, unknown>;
  },
  tx?: Tx,
) {
  await (tx ?? db).insert(auditLog).values({
    storeId: entry.storeId ?? null,
    actor: entry.actor,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    data: entry.data ?? null,
  });
}
