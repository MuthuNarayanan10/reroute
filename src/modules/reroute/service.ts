import { and, between, eq, gte, inArray, ne, sql } from 'drizzle-orm';
import { env } from '../../config/env.js';
import { db } from '../../db/client.js';
import {
  checkouts,
  orderItems,
  orders,
  pincodes,
  rerouteCases,
  rerouteOffers,
  shipments,
  type RerouteCase,
} from '../../db/schema.js';
import { audit } from '../../lib/audit.js';
import { boundingBox } from '../../lib/geo.js';
import { logger } from '../../lib/logger.js';
import { rerouteOutcomes } from '../../lib/metrics.js';
import { applyDiscountBps, formatInr } from '../../lib/money.js';
import { enqueue } from '../../lib/queues.js';
import { cancelPaymentLink, createPaymentLink, refundPayment } from '../../integrations/razorpay/client.js';
import { sendTemplate } from '../../integrations/whatsapp/client.js';
import { courierAdapter, hasCourier } from '../../integrations/courier/registry.js';
import { getStore, settingsOf, shopifyClientFor } from '../stores/service.js';
import { checkEligibility } from './eligibility.js';
import { rankCandidates } from './matcher.js';

const CANDIDATE_LOOKBACK_DAYS = 14;

/**
 * Step 1 — a shipment just got an NDR. Decide if it can be rescued and, if so,
 * send prepaid offers to the best nearby shoppers who wanted the same product.
 */
export async function evaluateShipment(storeId: string, shipmentId: string): Promise<RerouteCase | null> {
  const e = env();
  const [shipment] = await db
    .select()
    .from(shipments)
    .where(and(eq(shipments.id, shipmentId), eq(shipments.storeId, storeId)))
    .limit(1);
  if (!shipment) return null;

  const [created] = await db
    .insert(rerouteCases)
    .values({ storeId, shipmentId, orderId: shipment.orderId, status: 'evaluating' })
    .onConflictDoNothing()
    .returning();
  if (!created) return null; // already evaluated (idempotent)
  const caseId = created.id;

  const finish = async (status: RerouteCase['status'], reason: string) => {
    await db.update(rerouteCases).set({ status, reason }).where(eq(rerouteCases.id, caseId));
    rerouteOutcomes.inc({ outcome: status });
    return { ...created, status, reason };
  };

  const store = await getStore(storeId);
  if (!store || store.status !== 'active') return finish('ineligible', 'store inactive');
  const settings = settingsOf(store);

  const [order] = await db.select().from(orders).where(eq(orders.id, shipment.orderId)).limit(1);
  if (!order) return finish('failed', 'order missing');
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));

  const eligibility = checkEligibility({
    settings,
    order,
    items,
    shipment,
    courierSupported: hasCourier(shipment.courier),
  });
  if (!eligibility.eligible) return finish('ineligible', eligibility.reason);

  const pin = shipment.destinationPincode ?? order.shippingPincode;
  const [geo] = pin ? await db.select().from(pincodes).where(eq(pincodes.pincode, pin)).limit(1) : [];
  if (!geo) return finish('no_match', `no geo data for pincode ${pin ?? '(none)'}`);

  const center = { lat: geo.lat, lng: geo.lng };
  const box = boundingBox(center, e.REROUTE_RADIUS_KM);
  const since = new Date(Date.now() - CANDIDATE_LOOKBACK_DAYS * 86400_000);

  // Pre-filter in SQL with a bounding box; exact distance + ranking happen in the matcher.
  const rows = await db
    .select({ checkout: checkouts, lat: pincodes.lat, lng: pincodes.lng })
    .from(checkouts)
    .innerJoin(pincodes, eq(pincodes.pincode, checkouts.pincode))
    .where(
      and(
        eq(checkouts.storeId, storeId),
        eq(checkouts.status, 'abandoned'),
        eq(checkouts.whatsappConsent, true),
        gte(checkouts.abandonedAt, since),
        between(pincodes.lat, box.minLat, box.maxLat),
        between(pincodes.lng, box.minLng, box.maxLng),
      ),
    )
    .limit(1000);

  const ranked = rankCandidates({
    parcel: {
      lines: items.map((i) => ({ variantId: i.variantId, sku: i.sku, quantity: i.quantity })),
      location: center,
      valuePaise: order.totalPaise,
      originalPhoneE164: order.shippingAddress?.phoneE164 ?? null,
    },
    candidates: rows.map((r) => ({
      checkoutId: r.checkout.id,
      phoneE164: r.checkout.customerPhoneE164,
      whatsappConsent: r.checkout.whatsappConsent,
      location: { lat: r.lat, lng: r.lng },
      abandonedAt: r.checkout.abandonedAt,
      totalPaise: r.checkout.totalPaise,
      lines: r.checkout.lines,
    })),
    radiusKm: e.REROUTE_RADIUS_KM,
    now: new Date(),
    maxCandidates: e.REROUTE_MAX_CANDIDATES,
  });
  if (ranked.length === 0) return finish('no_match', 'no nearby buyer with matching cart');

  // Price on item value only: the parcel is already near the buyer, so shipping is free.
  const itemsTotal = items.reduce((s, i) => s + i.unitPricePaise * i.quantity, 0);
  const pricePaise = applyDiscountBps(itemsTotal, settings.rerouteDiscountBps);
  const deadlineAt = new Date(Date.now() + e.REROUTE_OFFER_TTL_MINUTES * 60_000);
  await db
    .update(rerouteCases)
    .set({ status: 'offered', offerPricePaise: pricePaise, deadlineAt })
    .where(eq(rerouteCases.id, caseId));

  const productName = items.length === 1 ? items[0]!.title : `${items[0]!.title} + ${items.length - 1} more`;
  let sent = 0;
  for (const c of ranked) {
    try {
      const [offer] = await db
        .insert(rerouteOffers)
        .values({
          caseId,
          storeId,
          checkoutId: c.checkoutId,
          phoneE164: c.phoneE164,
          distanceKm: c.distanceKm,
          score: c.score,
          pricePaise,
        })
        .returning();
      if (!offer) continue;
      const link = await createPaymentLink({
        amountPaise: pricePaise,
        referenceId: offer.id,
        description: `${productName} — arriving fast from nearby`,
        customer: { phoneE164: c.phoneE164 },
        expireAt: deadlineAt,
        notes: { kind: 'reroute', entity_id: offer.id, case_id: caseId, store_id: storeId },
      });
      await db
        .update(rerouteOffers)
        .set({ paymentLinkId: link.id, paymentLinkUrl: link.short_url })
        .where(eq(rerouteOffers.id, offer.id));
      await sendTemplate({
        toE164: c.phoneE164,
        template: e.WHATSAPP_TEMPLATE_REROUTE,
        bodyParams: [productName, formatInr(itemsTotal), formatInr(pricePaise), link.short_url],
      });
      sent++;
    } catch (err) {
      logger.warn({ err, caseId }, 'failed to send one reroute offer');
    }
  }
  if (sent === 0) return finish('failed', 'could not send any offer');

  await enqueue('reroute.expire', { caseId }, { jobId: `reroute-expire-${caseId}`, delay: deadlineAt.getTime() - Date.now() });
  await audit({ storeId, actor: 'system', action: 'reroute_offered', entity: 'shipment', entityId: shipmentId, data: { sent, pricePaise } });
  rerouteOutcomes.inc({ outcome: 'offered' });
  return { ...created, status: 'offered', offerPricePaise: pricePaise, deadlineAt };
}

/**
 * Step 2 — a buyer paid. First valid payment wins (row lock on the case);
 * any later payer is refunded automatically. Safe to call repeatedly.
 */
export async function handleOfferPaid(offerId: string, paymentId: string, amountPaise: number): Promise<void> {
  const decision = await db.transaction(async (tx) => {
    const [offer] = await tx.select().from(rerouteOffers).where(eq(rerouteOffers.id, offerId)).for('update').limit(1);
    if (!offer) return { kind: 'ignore' as const };
    const [rc] = await tx.select().from(rerouteCases).where(eq(rerouteCases.id, offer.caseId)).for('update').limit(1);
    if (!rc) return { kind: 'ignore' as const };

    // Replay of the winning payment: just (re)drive completion.
    if (rc.winningOfferId === offerId) return { kind: 'complete' as const, caseId: rc.id };

    const valid = rc.status === 'offered' && amountPaise === offer.pricePaise && offer.status === 'sent';
    if (!valid) {
      await tx
        .update(rerouteOffers)
        .set({ status: 'refunded', razorpayPaymentId: paymentId, paidAt: new Date() })
        .where(eq(rerouteOffers.id, offerId));
      return { kind: 'refund' as const, storeId: rc.storeId };
    }

    await tx
      .update(rerouteOffers)
      .set({ status: 'paid', razorpayPaymentId: paymentId, paidAt: new Date() })
      .where(eq(rerouteOffers.id, offerId));
    const losers = await tx
      .update(rerouteOffers)
      .set({ status: 'superseded' })
      .where(and(eq(rerouteOffers.caseId, rc.id), ne(rerouteOffers.id, offerId), eq(rerouteOffers.status, 'sent')))
      .returning({ linkId: rerouteOffers.paymentLinkId });
    await tx.update(rerouteCases).set({ status: 'claimed', winningOfferId: offerId }).where(eq(rerouteCases.id, rc.id));
    return { kind: 'claimed' as const, caseId: rc.id, loserLinks: losers.map((l) => l.linkId).filter((x): x is string => !!x) };
  });

  if (decision.kind === 'refund') {
    await refundPayment(paymentId, { reason: 'reroute parcel already claimed', offer_id: offerId });
    rerouteOutcomes.inc({ outcome: 'late_payment_refunded' });
    return;
  }
  if (decision.kind === 'claimed') {
    await Promise.allSettled(decision.loserLinks.map((id) => cancelPaymentLink(id)));
    rerouteOutcomes.inc({ outcome: 'claimed' });
  }
  if (decision.kind === 'claimed' || decision.kind === 'complete') {
    await completeCase(decision.caseId);
  }
}

/**
 * Step 3 — redirect the parcel and fix the orders. Each step checks whether it already
 * happened, so a crash mid-way is safely resumed by the job retry.
 */
export async function completeCase(caseId: string): Promise<void> {
  const [rc] = await db.select().from(rerouteCases).where(eq(rerouteCases.id, caseId)).limit(1);
  if (!rc || rc.status === 'completed' || !rc.winningOfferId) return;
  const [offer] = await db.select().from(rerouteOffers).where(eq(rerouteOffers.id, rc.winningOfferId)).limit(1);
  const [shipment] = await db.select().from(shipments).where(eq(shipments.id, rc.shipmentId)).limit(1);
  const [order] = await db.select().from(orders).where(eq(orders.id, rc.orderId)).limit(1);
  const [checkout] = offer?.checkoutId
    ? await db.select().from(checkouts).where(eq(checkouts.id, offer.checkoutId)).limit(1)
    : [];
  const store = await getStore(rc.storeId);
  if (!offer || !shipment || !order || !store) throw new Error(`reroute case ${caseId} missing data`);

  const address = checkout?.shippingAddress;
  if (!address) {
    await failAndRefund(rc, offer.razorpayPaymentId, 'buyer address missing');
    return;
  }

  // 3a. Redirect the parcel with the courier.
  if (shipment.status !== 'rerouted') {
    const res = await courierAdapter(shipment.courier).updateConsignee(shipment.awb, {
      ...address,
      phoneE164: address.phoneE164 ?? offer.phoneE164,
    });
    if (!res.ok) {
      await failAndRefund(rc, offer.razorpayPaymentId, `courier rejected consignee change: ${res.reason ?? 'unknown'}`);
      return;
    }
    await db
      .update(shipments)
      .set({ status: 'rerouted', destinationPincode: address.pincode })
      .where(eq(shipments.id, shipment.id));
  }

  // 3b. Create the new paid order and cancel the original on the store platform.
  let newOrderExternalId = rc.newOrderExternalId;
  if (store.platform === 'shopify') {
    const shopify = shopifyClientFor(store);
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    if (!newOrderExternalId) {
      const itemsTotal = items.reduce((s, i) => s + i.unitPricePaise * i.quantity, 0);
      const created = await shopify.createPaidOrder({
        lines: items,
        discountPaise: Math.max(0, itemsTotal - offer.pricePaise),
        address: { ...address, phoneE164: address.phoneE164 ?? offer.phoneE164 },
        note: `ReRoute: parcel AWB ${shipment.awb} redirected from order ${order.orderNumber ?? order.externalId}`,
        tags: ['reroute', 'prepaid'],
      });
      newOrderExternalId = created.orderExternalId;
      await db.update(rerouteCases).set({ newOrderExternalId }).where(eq(rerouteCases.id, caseId));
    }
    if (order.status !== 'rerouted_out') {
      await shopify.cancelOrder(order.externalId, `ReRoute: delivery failed; parcel sold to nearby buyer (${newOrderExternalId})`);
    }
  }

  await db.transaction(async (tx) => {
    await tx.update(orders).set({ status: 'rerouted_out' }).where(eq(orders.id, order.id));
    if (checkout) await tx.update(checkouts).set({ status: 'used_for_reroute' }).where(eq(checkouts.id, checkout.id));
    // savedPaise = revenue recovered instead of an RTO (dashboard "₹ rescued").
    await tx.update(rerouteCases).set({ status: 'completed', savedPaise: offer.pricePaise }).where(eq(rerouteCases.id, caseId));
    await audit(
      { storeId: rc.storeId, actor: 'system', action: 'reroute_completed', entity: 'reroute_case', entityId: caseId, data: { newOrderExternalId } },
      tx,
    );
  });
  rerouteOutcomes.inc({ outcome: 'completed' });
}

async function failAndRefund(rc: RerouteCase, paymentId: string | null, reason: string) {
  if (paymentId) await refundPayment(paymentId, { reason: reason.slice(0, 200), case_id: rc.id });
  await db.update(rerouteCases).set({ status: 'failed', reason }).where(eq(rerouteCases.id, rc.id));
  if (rc.winningOfferId) await db.update(rerouteOffers).set({ status: 'refunded' }).where(eq(rerouteOffers.id, rc.winningOfferId));
  rerouteOutcomes.inc({ outcome: 'failed' });
  logger.warn({ caseId: rc.id, reason }, 'reroute failed; buyer refunded, parcel continues RTO');
}

/** Nobody paid in time: close links and let the normal RTO continue. */
export async function expireCase(caseId: string): Promise<void> {
  const [rc] = await db.select().from(rerouteCases).where(eq(rerouteCases.id, caseId)).limit(1);
  if (!rc || rc.status !== 'offered') return;
  const open = await db
    .update(rerouteOffers)
    .set({ status: 'expired' })
    .where(and(eq(rerouteOffers.caseId, caseId), eq(rerouteOffers.status, 'sent')))
    .returning({ linkId: rerouteOffers.paymentLinkId });
  await db.update(rerouteCases).set({ status: 'expired', reason: 'no buyer paid before deadline' }).where(eq(rerouteCases.id, caseId));
  await Promise.allSettled(open.map((o) => (o.linkId ? cancelPaymentLink(o.linkId) : Promise.resolve())));
  rerouteOutcomes.inc({ outcome: 'expired' });
}

export async function handleOfferClosed(offerId: string): Promise<void> {
  await db
    .update(rerouteOffers)
    .set({ status: 'expired' })
    .where(and(eq(rerouteOffers.id, offerId), inArray(rerouteOffers.status, ['sent'])));
}

/** Dashboard summary. */
export async function rerouteStats(storeId: string) {
  const rows = await db
    .select({
      status: rerouteCases.status,
      count: sql<number>`count(*)::int`,
      recovered: sql<number>`coalesce(sum(${rerouteCases.savedPaise}), 0)::int`,
    })
    .from(rerouteCases)
    .where(eq(rerouteCases.storeId, storeId))
    .groupBy(rerouteCases.status);
  return rows;
}
