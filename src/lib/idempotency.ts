import { webhookReceipts } from '../db/schema.js';
import { db } from '../db/client.js';

/**
 * Records a webhook delivery. Returns true the first time an id is seen,
 * false on duplicates (so callers can safely skip re-processing).
 */
export async function firstTimeSeen(source: string, topic: string, id: string): Promise<boolean> {
  const rows = await db
    .insert(webhookReceipts)
    .values({ id: `${source}:${id}`, source, topic })
    .onConflictDoNothing()
    .returning({ id: webhookReceipts.id });
  return rows.length > 0;
}
