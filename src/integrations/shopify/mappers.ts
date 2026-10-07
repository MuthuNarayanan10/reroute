import { rupeesStringToPaise } from '../../lib/money.js';
import { toE164India } from '../../lib/phone.js';
import { isValidPincode } from '../../lib/geo.js';
import type { ShippingAddress } from '../../db/schema.js';
import type { NormalizedCheckout, NormalizedOrder } from '../../modules/order-sync/types.js';

/** Subset of the Shopify REST-style webhook payload we rely on. */
export interface ShopifyAddress {
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  zip?: string | null;
  country_code?: string | null;
}

export interface ShopifyLineItem {
  variant_id?: number | string | null;
  sku?: string | null;
  title: string;
  quantity: number;
  price: string;
}

export interface ShopifyOrderPayload {
  id: number | string;
  name?: string | null;
  financial_status?: string | null;
  cancelled_at?: string | null;
  total_price: string;
  currency?: string | null;
  payment_gateway_names?: string[] | null;
  phone?: string | null;
  email?: string | null;
  buyer_accepts_marketing?: boolean | null;
  customer?: {
    id?: number | string | null;
    first_name?: string | null;
    last_name?: string | null;
    phone?: string | null;
    email?: string | null;
    sms_marketing_consent?: { state?: string | null } | null;
  } | null;
  shipping_address?: ShopifyAddress | null;
  line_items: ShopifyLineItem[];
  tags?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShopifyCheckoutPayload {
  id: number | string;
  token?: string | null;
  phone?: string | null;
  email?: string | null;
  buyer_accepts_marketing?: boolean | null;
  shipping_address?: ShopifyAddress | null;
  line_items: ShopifyLineItem[];
  total_price: string;
  abandoned_checkout_url?: string | null;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
}

const COD_GATEWAY_RE = /(cash on delivery|cod|cash_on_delivery)/i;

export function detectPaymentMode(o: Pick<ShopifyOrderPayload, 'payment_gateway_names' | 'financial_status' | 'tags'>):
  NormalizedOrder['paymentMode'] {
  const gateways = o.payment_gateway_names ?? [];
  const hasCod = gateways.some((g) => COD_GATEWAY_RE.test(g));
  const hasPrepaid = gateways.some((g) => !COD_GATEWAY_RE.test(g));
  if (hasCod && hasPrepaid) return 'partial_cod';
  if (/partial[-_ ]?cod/i.test(o.tags ?? '')) return 'partial_cod';
  if (hasCod) return o.financial_status === 'paid' ? 'prepaid' : 'cod';
  return 'prepaid';
}

export function mapAddress(a: ShopifyAddress | null | undefined, fallbackPhone?: string | null): ShippingAddress | null {
  if (!a || !a.address1 || !a.zip) return null;
  const pin = a.zip.replace(/\s/g, '');
  return {
    name: a.name ?? [a.first_name, a.last_name].filter(Boolean).join(' '),
    phoneE164: toE164India(a.phone ?? fallbackPhone),
    address1: a.address1,
    address2: a.address2 ?? null,
    city: a.city ?? '',
    state: a.province ?? '',
    pincode: isValidPincode(pin) ? pin : pin,
    country: a.country_code ?? 'IN',
  };
}

function mapLine(l: ShopifyLineItem) {
  return {
    variantId: l.variant_id != null ? String(l.variant_id) : null,
    sku: l.sku || null,
    title: l.title,
    quantity: l.quantity,
    unitPricePaise: rupeesStringToPaise(l.price),
  };
}

export function mapShopifyOrder(o: ShopifyOrderPayload): NormalizedOrder {
  const phone = toE164India(o.customer?.phone ?? o.phone ?? o.shipping_address?.phone);
  const consent = o.customer?.sms_marketing_consent?.state === 'subscribed' || o.buyer_accepts_marketing === true;
  return {
    externalId: String(o.id),
    orderNumber: o.name ?? null,
    paymentMode: detectPaymentMode(o),
    financialStatus: o.financial_status ?? null,
    cancelled: !!o.cancelled_at,
    totalPaise: rupeesStringToPaise(o.total_price),
    currency: o.currency ?? 'INR',
    customer: {
      externalId: o.customer?.id != null ? String(o.customer.id) : null,
      name: [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(' ') || null,
      email: o.customer?.email ?? o.email ?? null,
      phoneE164: phone,
      // Transactional order updates are allowed; marketing-style offers require consent.
      whatsappConsent: consent,
    },
    shippingAddress: mapAddress(o.shipping_address, o.phone),
    items: o.line_items.map(mapLine),
    placedAt: new Date(o.created_at),
    sourceUpdatedAt: new Date(o.updated_at),
  };
}

export function mapShopifyCheckout(c: ShopifyCheckoutPayload): NormalizedCheckout {
  const address = mapAddress(c.shipping_address, c.phone);
  return {
    externalId: String(c.id),
    customerPhoneE164: toE164India(c.phone ?? c.shipping_address?.phone),
    customerName: address?.name ?? null,
    whatsappConsent: c.buyer_accepts_marketing === true,
    pincode: address?.pincode ?? null,
    shippingAddress: address,
    lines: c.line_items.map(mapLine),
    totalPaise: rupeesStringToPaise(c.total_price),
    recoveryUrl: c.abandoned_checkout_url ?? null,
    abandonedAt: new Date(c.updated_at),
    completed: !!c.completed_at,
  };
}
