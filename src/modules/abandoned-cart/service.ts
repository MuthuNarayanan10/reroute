import { and, eq } from 'drizzle-orm';
import { env } from '../../config/env.js';
import { db } from '../../db/client.js';
import { checkouts } from '../../db/schema.js';
import { enqueue } from '../../lib/queues.js';
import { formatInr } from '../../lib/money.js';
import { sendTemplate } from '../../integrations/whatsapp/client.js';
import type { NormalizedCheckout } from '../order-sync/types.js';

/** Delays between reminders. Keep it to 2 — more feels like spam and hurts the sender number's quality. */
const NUDGE_DELAYS_MS = [60 * 60 * 1000, 24 * 60 * 60 * 1000];

export async function upsertCheckout(storeId: string, c: NormalizedCheckout) {
  if (c.completed) {
    await db
      .update(checkouts)
      .set({ status: 'recovered' })
      .where(and(eq(checkouts.storeId, storeId), eq(checkouts.externalId, c.externalId)));
    return;
  }
  const [row] = await db
    .insert(checkouts)
    .values({ storeId, ...omitCompleted(c), status: 'abandoned' })
    .onConflictDoUpdate({
      target: [checkouts.storeId, checkouts.externalId],
      set: {
        customerPhoneE164: c.customerPhoneE164,
        customerName: c.customerName,
        whatsappConsent: c.whatsappConsent,
        pincode: c.pincode,
        shippingAddress: c.shippingAddress,
        lines: c.lines,
        totalPaise: c.totalPaise,
        recoveryUrl: c.recoveryUrl,
        abandonedAt: c.abandonedAt,
      },
    })
    .returning({ id: checkouts.id, nudgeCount: checkouts.nudgeCount });

  if (row && row.nudgeCount === 0 && c.customerPhoneE164 && c.whatsappConsent) {
    await enqueue('cart.nudge', { storeId, checkoutId: row.id }, { jobId: `cart-${row.id}-0`, delay: NUDGE_DELAYS_MS[0] });
  }
}

function omitCompleted(c: NormalizedCheckout) {
  const { completed: _completed, ...rest } = c;
  return rest;
}

export async function nudge(checkoutId: string): Promise<'sent' | 'skipped'> {
  const [c] = await db.select().from(checkouts).where(eq(checkouts.id, checkoutId)).limit(1);
  if (!c || c.status !== 'abandoned' || !c.customerPhoneE164 || !c.whatsappConsent || !c.recoveryUrl) return 'skipped';
  if (c.nudgeCount >= NUDGE_DELAYS_MS.length) return 'skipped';

  const firstItem = c.lines[0]?.title ?? 'your items';
  await sendTemplate({
    toE164: c.customerPhoneE164,
    template: env().WHATSAPP_TEMPLATE_CART,
    bodyParams: [c.customerName?.split(' ')[0] || 'there', firstItem, formatInr(c.totalPaise)],
    urlButtonParam: c.recoveryUrl.replace(/^https?:\/\/[^/]+\//, ''),
  });

  const nudgeCount = c.nudgeCount + 1;
  await db.update(checkouts).set({ nudgeCount, lastNudgedAt: new Date() }).where(eq(checkouts.id, checkoutId));

  const nextDelay = NUDGE_DELAYS_MS[nudgeCount];
  if (nextDelay) {
    await enqueue('cart.nudge', { storeId: c.storeId, checkoutId }, { jobId: `cart-${checkoutId}-${nudgeCount}`, delay: nextDelay });
  }
  return 'sent';
}
