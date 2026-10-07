import { and, eq } from 'drizzle-orm';
import { env } from '../../config/env.js';
import { db } from '../../db/client.js';
import { customers, orderItems, orders, pincodeStats, prepaidConversions } from '../../db/schema.js';
import { audit } from '../../lib/audit.js';
import { logger } from '../../lib/logger.js';
import { prepaidOutcomes } from '../../lib/metrics.js';
import { formatInr } from '../../lib/money.js';
import { createPaymentLink } from '../../integrations/razorpay/client.js';
import { sendTemplate } from '../../integrations/whatsapp/client.js';
import { getStore, settingsOf, shopifyClientFor } from '../stores/service.js';
import { istHour, scoreCodRisk } from './risk.js';

const LINK_TTL_MS = 24 * 3600 * 1000;

/** Scores a new COD order and, if risky, offers the buyer a discounted prepaid link before dispatch. */
export async function evaluateCodOrder(storeId: string, orderId: string): Promise<void> {
  const store = await getStore(storeId);
  if (!store || store.status !== 'active') return;
  const settings = settingsOf(store);

  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.storeId, storeId)))
    .limit(1);
  if (!order || order.paymentMode !== 'cod' || order.status !== 'open') return;

  const [customer] = order.customerId
    ? await db.select().from(customers).where(eq(customers.id, order.customerId)).limit(1)
    : [];
  const [pin] = order.shippingPincode
    ? await db
        .select()
        .from(pincodeStats)
        .where(and(eq(pincodeStats.storeId, storeId), eq(pincodeStats.pincode, order.shippingPincode)))
        .limit(1)
    : [];
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));

  const phone = order.shippingAddress?.phoneE164 ?? customer?.phoneE164 ?? null;
  const risk = scoreCodRisk(
    {
      orderValuePaise: order.totalPaise,
      customer: customer
        ? { ordersCount: customer.ordersCount, deliveredCount: customer.deliveredCount, rtoCount: customer.rtoCount }
        : null,
      pincode: pin ? { delivered: pin.delivered, rto: pin.rto } : null,
      hasValidPhone: !!phone,
      address1: order.shippingAddress?.address1 ?? null,
      maxLineQuantity: Math.max(0, ...items.map((i) => i.quantity)),
      placedHourIst: istHour(order.placedAt),
    },
    settings,
  );

  await db
    .update(orders)
    .set({ riskScore: risk.score, riskAction: risk.action, riskReasons: risk.reasons })
    .where(eq(orders.id, orderId));

  const shopify = store.platform === 'shopify' ? shopifyClientFor(store) : null;
  if (risk.action !== 'allow') {
    await shopify?.addTags(order.externalId, [`cod-risk-${risk.action}`]).catch((err) =>
      logger.warn({ err, orderId }, 'failed to tag order'),
    );
  }

  const shouldOffer =
    settings.codPrepaidEnabled && !!phone && (risk.action === 'nudge_prepaid' || risk.action === 'partial_cod');
  if (!shouldOffer || !phone) return;

  const discountPaise = Math.min(settings.prepaidDiscountPaise, Math.floor(order.totalPaise * 0.2));
  const amountPaise = order.totalPaise - discountPaise;

  // Claim the conversion row first (unique per order) so retries never send two links.
  const [conv] = await db
    .insert(prepaidConversions)
    .values({ storeId, orderId, riskScore: risk.score, discountPaise, amountPaise })
    .onConflictDoNothing()
    .returning();
  if (!conv) return;

  try {
    const link = await createPaymentLink({
      amountPaise,
      referenceId: conv.id,
      description: `Prepay order ${order.orderNumber ?? ''} and save ${formatInr(discountPaise)}`,
      customer: { name: order.shippingAddress?.name, phoneE164: phone },
      expireAt: new Date(Date.now() + LINK_TTL_MS),
      notes: { kind: 'prepaid', entity_id: conv.id, store_id: storeId, order_id: orderId },
    });
    await db
      .update(prepaidConversions)
      .set({ paymentLinkId: link.id, paymentLinkUrl: link.short_url })
      .where(eq(prepaidConversions.id, conv.id));

    // Utility template tied to the buyer's own order — not a marketing message.
    await sendTemplate({
      toE164: phone,
      template: env().WHATSAPP_TEMPLATE_PREPAID,
      bodyParams: [
        order.shippingAddress?.name?.split(' ')[0] || 'there',
        order.orderNumber ?? '',
        formatInr(discountPaise),
        link.short_url,
      ],
    });
    prepaidOutcomes.inc({ outcome: 'sent' });
    await audit({ storeId, actor: 'system', action: 'prepaid_offer_sent', entity: 'order', entityId: orderId, data: { risk } });
  } catch (err) {
    await db.update(prepaidConversions).set({ status: 'failed' }).where(eq(prepaidConversions.id, conv.id));
    prepaidOutcomes.inc({ outcome: 'failed' });
    throw err;
  }
}

/** Called from the Razorpay webhook when the prepaid link is paid. Idempotent. */
export async function handlePrepaidPaid(conversionId: string, paymentId: string, amountPaise: number): Promise<void> {
  const [conv] = await db.select().from(prepaidConversions).where(eq(prepaidConversions.id, conversionId)).limit(1);
  if (!conv || conv.status === 'paid') return;
  if (amountPaise !== conv.amountPaise) {
    logger.error({ conversionId, amountPaise, expected: conv.amountPaise }, 'prepaid amount mismatch');
    return;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(prepaidConversions)
      .set({ status: 'paid', paidAt: new Date(), razorpayPaymentId: paymentId })
      .where(eq(prepaidConversions.id, conversionId));
    await tx
      .update(orders)
      .set({ paymentMode: 'prepaid', financialStatus: 'paid' })
      .where(eq(orders.id, conv.orderId));
    await audit(
      { storeId: conv.storeId, actor: 'razorpay', action: 'cod_converted_to_prepaid', entity: 'order', entityId: conv.orderId },
      tx,
    );
  });
  prepaidOutcomes.inc({ outcome: 'paid' });

  const store = await getStore(conv.storeId);
  const [order] = await db.select().from(orders).where(eq(orders.id, conv.orderId)).limit(1);
  if (store?.platform === 'shopify' && order) {
    const shopify = shopifyClientFor(store);
    await shopify.markOrderPaid(order.externalId);
    await shopify.addTags(order.externalId, ['converted-to-prepaid', `prepaid-discount-${conv.discountPaise / 100}`]);
  }
}

export async function handlePrepaidClosed(conversionId: string): Promise<void> {
  await db
    .update(prepaidConversions)
    .set({ status: 'expired' })
    .where(and(eq(prepaidConversions.id, conversionId), eq(prepaidConversions.status, 'sent')));
  prepaidOutcomes.inc({ outcome: 'expired' });
}
