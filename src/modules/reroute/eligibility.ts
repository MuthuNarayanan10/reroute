import type { StoreSettings } from '../../db/schema.js';

export interface EligibilityInput {
  settings: Pick<StoreSettings, 'rerouteEnabled' | 'rerouteMinOrderPaise' | 'rerouteExcludedSkus'>;
  order: { paymentMode: 'cod' | 'prepaid' | 'partial_cod'; status: string; totalPaise: number };
  items: Array<{ sku: string | null; variantId: string | null; quantity: number }>;
  shipment: { status: string; ndrCount: number; lastNdrReason: string | null };
  courierSupported: boolean;
}

export type Eligibility = { eligible: true } | { eligible: false; reason: string };

/** Reasons where the original buyer may still accept on re-attempt — try them first. */
const RECOVERABLE_REASON_RE = /(rescheduled|future delivery|customer asked)/i;

export function checkEligibility(i: EligibilityInput): Eligibility {
  if (!i.settings.rerouteEnabled) return no('reroute disabled for store');
  if (!i.courierSupported) return no('courier does not support consignee change');
  if (i.shipment.status !== 'ndr') return no(`shipment status is ${i.shipment.status}`);
  if (i.order.paymentMode !== 'cod') return no('only unpaid COD orders are rerouted (prepaid needs refund flow)');
  if (i.order.status !== 'open' && i.order.status !== 'fulfilled') return no(`order status is ${i.order.status}`);
  if (i.order.totalPaise < i.settings.rerouteMinOrderPaise) return no('order value below reroute minimum');
  if (i.items.length === 0) return no('order has no items');
  if (i.items.length > 3) return no('too many distinct items to match a single buyer');
  if (i.items.some((it) => !it.variantId && !it.sku)) return no('items missing variant/sku identifiers');
  const excluded = new Set(i.settings.rerouteExcludedSkus.map((s) => s.toLowerCase()));
  if (i.items.some((it) => it.sku && excluded.has(it.sku.toLowerCase()))) return no('contains excluded SKU');
  if (i.shipment.ndrCount < 2 && i.shipment.lastNdrReason && RECOVERABLE_REASON_RE.test(i.shipment.lastNdrReason)) {
    return no('original buyer requested reschedule; re-attempt first');
  }
  return { eligible: true };
}

function no(reason: string): Eligibility {
  return { eligible: false, reason };
}
