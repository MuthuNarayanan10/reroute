import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { checkouts, customers, orderItems, orders } from '../../db/schema.js';
import { enqueue } from '../../lib/queues.js';
import { logger } from '../../lib/logger.js';
import type { NormalizedOrder } from './types.js';

export interface UpsertResult {
  orderId: string;
  created: boolean;
  skipped: boolean;
}

/**
 * Idempotent order upsert.
 * - Out-of-order webhooks are ignored using the platform's updated_at.
 * - New COD orders are queued for risk evaluation.
 */
export async function upsertOrder(storeId: string, o: NormalizedOrder): Promise<UpsertResult> {
  const result = await db.transaction(async (tx) => {
    let customerId: string | null = null;
    if (o.customer.phoneE164) {
      const [c] = await tx
        .insert(customers)
        .values({
          storeId,
          externalId: o.customer.externalId,
          phoneE164: o.customer.phoneE164,
          email: o.customer.email,
          name: o.customer.name,
          whatsappConsent: o.customer.whatsappConsent,
        })
        .onConflictDoUpdate({
          target: [customers.storeId, customers.phoneE164],
          set: {
            externalId: o.customer.externalId,
            email: o.customer.email,
            name: o.customer.name,
            // Consent only ever upgrades here; withdrawal comes through an explicit opt-out path.
            ...(o.customer.whatsappConsent ? { whatsappConsent: true } : {}),
          },
        })
        .returning({ id: customers.id });
      customerId = c?.id ?? null;
    }

    const [existing] = await tx
      .select({ id: orders.id, sourceUpdatedAt: orders.sourceUpdatedAt, status: orders.status })
      .from(orders)
      .where(and(eq(orders.storeId, storeId), eq(orders.externalId, o.externalId)))
      .limit(1);

    if (existing && existing.sourceUpdatedAt >= o.sourceUpdatedAt) {
      return { orderId: existing.id, created: false, skipped: true };
    }

    // Never overwrite lifecycle states we own (delivered / rto / rerouted) with "open".
    const ownedStates = new Set(['delivered', 'rto', 'rerouted_out']);
    const status = o.cancelled ? 'cancelled' : existing && ownedStates.has(existing.status) ? existing.status : 'open';

    const values = {
      storeId,
      externalId: o.externalId,
      orderNumber: o.orderNumber,
      customerId,
      paymentMode: o.paymentMode,
      financialStatus: o.financialStatus,
      status,
      totalPaise: o.totalPaise,
      currency: o.currency,
      shippingAddress: o.shippingAddress,
      shippingPincode: o.shippingAddress?.pincode ?? null,
      placedAt: o.placedAt,
      sourceUpdatedAt: o.sourceUpdatedAt,
    } as const;

    let orderId: string;
    if (existing) {
      await tx.update(orders).set(values).where(eq(orders.id, existing.id));
      orderId = existing.id;
      await tx.delete(orderItems).where(eq(orderItems.orderId, orderId));
    } else {
      const [row] = await tx.insert(orders).values(values).returning({ id: orders.id });
      if (!row) throw new Error('order insert failed');
      orderId = row.id;
      if (customerId) {
        const [c] = await tx.select().from(customers).where(eq(customers.id, customerId));
        if (c) await tx.update(customers).set({ ordersCount: c.ordersCount + 1 }).where(eq(customers.id, customerId));
      }
    }

    if (o.items.length) {
      await tx.insert(orderItems).values(o.items.map((i) => ({ ...i, orderId, storeId })));
    }

    // A completed order recovers that buyer's open abandoned checkouts.
    if (!existing && o.customer.phoneE164) {
      await tx
        .update(checkouts)
        .set({ status: 'recovered' })
        .where(
          and(
            eq(checkouts.storeId, storeId),
            eq(checkouts.customerPhoneE164, o.customer.phoneE164),
            inArray(checkouts.status, ['abandoned']),
          ),
        );
    }

    return { orderId, created: !existing, skipped: false };
  });

  if (result.created && o.paymentMode === 'cod' && !o.cancelled) {
    await enqueue('cod.evaluate', { storeId, orderId: result.orderId }, { jobId: `cod-${result.orderId}` });
  }
  logger.debug({ storeId, orderId: result.orderId, created: result.created, skipped: result.skipped }, 'order upserted');
  return result;
}

export async function markCancelled(storeId: string, externalId: string) {
  await db
    .update(orders)
    .set({ status: 'cancelled' })
    .where(and(eq(orders.storeId, storeId), eq(orders.externalId, externalId)));
}
