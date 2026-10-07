import { env } from '../../config/env.js';
import { hmacSha256, safeEqual } from '../../lib/crypto.js';
import { fetchJson } from '../../lib/http.js';

const BASE = 'https://api.razorpay.com/v1';

function authHeader(): string {
  const e = env();
  return `Basic ${Buffer.from(`${e.RAZORPAY_KEY_ID}:${e.RAZORPAY_KEY_SECRET}`).toString('base64')}`;
}

export interface PaymentLink {
  id: string;
  short_url: string;
  status: string;
}

export interface CreatePaymentLinkInput {
  amountPaise: number;
  /** Our own id (prepaid conversion id / reroute offer id) — echoed back in webhooks. */
  referenceId: string;
  description: string;
  customer: { name?: string | null; phoneE164: string };
  expireAt: Date;
  notes: Record<string, string>;
}

export async function createPaymentLink(input: CreatePaymentLinkInput): Promise<PaymentLink> {
  return fetchJson<PaymentLink>(`${BASE}/payment_links`, {
    op: 'razorpay.payment_link.create',
    method: 'POST',
    headers: { authorization: authHeader() },
    retries: 1, // creating money objects: keep retries low; reference_id is unique on Razorpay's side
    body: {
      amount: input.amountPaise,
      currency: 'INR',
      accept_partial: false,
      reference_id: input.referenceId,
      description: input.description.slice(0, 2048),
      expire_by: Math.floor(input.expireAt.getTime() / 1000),
      customer: { name: input.customer.name ?? undefined, contact: input.customer.phoneE164 },
      // We send the link ourselves over WhatsApp.
      notify: { sms: false, email: false },
      reminder_enable: false,
      notes: input.notes,
    },
  });
}

export async function cancelPaymentLink(id: string): Promise<void> {
  await fetchJson(`${BASE}/payment_links/${encodeURIComponent(id)}/cancel`, {
    op: 'razorpay.payment_link.cancel',
    method: 'POST',
    headers: { authorization: authHeader() },
    retries: 2,
  });
}

/** Full refund — used when two buyers pay for the same rerouted parcel. */
export async function refundPayment(paymentId: string, notes: Record<string, string>): Promise<void> {
  await fetchJson(`${BASE}/payments/${encodeURIComponent(paymentId)}/refund`, {
    op: 'razorpay.refund',
    method: 'POST',
    headers: { authorization: authHeader() },
    body: { speed: 'optimum', notes },
    retries: 2,
  });
}

/** Razorpay signs the raw body (hex HMAC-SHA256) in the X-Razorpay-Signature header. */
export function verifyRazorpayWebhook(rawBody: Buffer | string, signature: string | undefined, secret: string): boolean {
  if (!signature) return false;
  return safeEqual(hmacSha256(secret, rawBody, 'hex'), signature);
}

export interface RazorpayPaymentLinkPaidEvent {
  event: 'payment_link.paid';
  payload: {
    payment_link: { entity: { id: string; reference_id: string; notes?: Record<string, string> } };
    payment: { entity: { id: string; amount: number; status: string } };
  };
}

export interface RazorpayPaymentLinkClosedEvent {
  event: 'payment_link.expired' | 'payment_link.cancelled';
  payload: { payment_link: { entity: { id: string; reference_id: string; notes?: Record<string, string> } } };
}

export type RazorpayEvent = RazorpayPaymentLinkPaidEvent | RazorpayPaymentLinkClosedEvent;
