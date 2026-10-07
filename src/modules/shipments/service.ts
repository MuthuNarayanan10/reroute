import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { customers, orders, pincodeStats, shipments, trackingEvents } from '../../db/schema.js';
import { logger } from '../../lib/logger.js';
import { enqueue } from '../../lib/queues.js';
import type { CourierEvent } from '../../integrations/courier/types.js';

/** Register a shipment (AWB) against an order — called by the fulfilment/courier flow or the admin API. */
export async function registerShipment(input: {
  storeId: string;
  orderId: string;
  courier: string;
  awb: string;
  destinationPincode?: string | null;
}) {
  const [row] = await db
    .insert(shipments)
    .values({
      storeId: input.storeId,
      orderId: input.orderId,
      courier: input.courier,
      awb: input.awb,
      destinationPincode: input.destinationPincode ?? null,
      status: 'created',
    })
    .onConflictDoNothing()
    .returning();
  if (row) await db.update(orders).set({ status: 'fulfilled' }).where(and(eq(orders.id, input.orderId), eq(orders.status, 'open')));
  return row;
}

/** Statuses that must never be overwritten by a late/out-of-order courier event. */
const TERMINAL = new Set(['delivered', 'rto_delivered']);

export async function applyCourierEvent(courier: string, ev: CourierEvent): Promise<void> {
  let [shipment] = await db
    .select()
    .from(shipments)
    .where(and(eq(shipments.courier, courier), eq(shipments.awb, ev.awb)))
    .limit(1);

  // Aggregators often echo our channel order id — auto-register unknown AWBs.
  if (!shipment && ev.orderRef) {
    const [order] = await db.select().from(orders).where(eq(orders.externalId, ev.orderRef)).limit(1);
    if (order) {
      shipment = await registerShipment({
        storeId: order.storeId,
        orderId: order.id,
        courier,
        awb: ev.awb,
        destinationPincode: order.shippingPincode,
      });
    }
  }
  if (!shipment) {
    logger.info({ courier, awb: ev.awb }, 'courier event for unknown shipment ignored');
    return;
  }

  const inserted = await db
    .insert(trackingEvents)
    .values({
      shipmentId: shipment.id,
      status: ev.status,
      rawStatus: ev.rawStatus,
      reason: ev.reason,
      occurredAt: ev.occurredAt,
      dedupeKey: ev.dedupeKey,
    })
    .onConflictDoNothing()
    .returning({ id: trackingEvents.id });
  if (inserted.length === 0) return; // duplicate delivery

  if (TERMINAL.has(shipment.status)) return;
  // A rerouted parcel keeps "rerouted" until it is delivered to the new buyer.
  if (shipment.status === 'rerouted' && ev.status !== 'delivered') return;

  const isNdr = ev.status === 'ndr';
  await db
    .update(shipments)
    .set({
      status: ev.status,
      lastEventAt: ev.occurredAt,
      ...(isNdr ? { ndrCount: sql`${shipments.ndrCount} + 1`, lastNdrReason: ev.reason } : {}),
    })
    .where(eq(shipments.id, shipment.id));

  if (isNdr) {
    // jobId makes this a one-shot: only the first NDR opens a ReRoute case.
    await enqueue(
      'reroute.evaluate',
      { storeId: shipment.storeId, shipmentId: shipment.id },
      { jobId: `reroute-${shipment.id}` },
    );
  }

  if (ev.status === 'delivered' || ev.status === 'rto_delivered') {
    await recordOutcome(shipment.storeId, shipment.orderId, ev.status === 'delivered' ? 'delivered' : 'rto', shipment.status === 'rerouted');
  }
}

/** Feeds the learning loop: customer + pincode outcome counters used by the risk model. */
async function recordOutcome(storeId: string, orderId: string, outcome: 'delivered' | 'rto', rerouted: boolean) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return;
  // For rerouted parcels the original buyer still counts as an RTO-style failure.
  const customerOutcome = rerouted ? 'rto' : outcome;

  await db.transaction(async (tx) => {
    if (!rerouted) {
      await tx.update(orders).set({ status: outcome === 'delivered' ? 'delivered' : 'rto' }).where(eq(orders.id, orderId));
    }
    if (order.customerId) {
      await tx
        .update(customers)
        .set(
          customerOutcome === 'delivered'
            ? { deliveredCount: sql`${customers.deliveredCount} + 1` }
            : { rtoCount: sql`${customers.rtoCount} + 1` },
        )
        .where(eq(customers.id, order.customerId));
    }
    if (order.shippingPincode && !rerouted) {
      await tx
        .insert(pincodeStats)
        .values({
          storeId,
          pincode: order.shippingPincode,
          delivered: outcome === 'delivered' ? 1 : 0,
          rto: outcome === 'rto' ? 1 : 0,
        })
        .onConflictDoUpdate({
          target: [pincodeStats.storeId, pincodeStats.pincode],
          set:
            outcome === 'delivered'
              ? { delivered: sql`${pincodeStats.delivered} + 1`, updatedAt: new Date() }
              : { rto: sql`${pincodeStats.rto} + 1`, updatedAt: new Date() },
        });
    }
  });
}
