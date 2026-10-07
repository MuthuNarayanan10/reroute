import { logger } from '../../lib/logger.js';
import type { RazorpayEvent } from '../../integrations/razorpay/client.js';
import { handlePrepaidClosed, handlePrepaidPaid } from '../cod-prepaid/service.js';
import { handleOfferClosed, handleOfferPaid } from '../reroute/service.js';

/** Routes Razorpay payment-link events to the module that created the link (via notes.kind). */
export async function handleRazorpayEvent(ev: RazorpayEvent): Promise<void> {
  const link = ev.payload.payment_link.entity;
  const kind = link.notes?.kind;
  const entityId = link.notes?.entity_id ?? link.reference_id;

  if (ev.event === 'payment_link.paid') {
    const payment = ev.payload.payment.entity;
    if (kind === 'prepaid') return handlePrepaidPaid(entityId, payment.id, payment.amount);
    if (kind === 'reroute') return handleOfferPaid(entityId, payment.id, payment.amount);
  } else {
    if (kind === 'prepaid') return handlePrepaidClosed(entityId);
    if (kind === 'reroute') return handleOfferClosed(entityId);
  }
  logger.warn({ event: ev.event, kind }, 'unhandled razorpay event');
}
