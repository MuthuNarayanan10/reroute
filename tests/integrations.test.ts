import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyRazorpayWebhook } from '../src/integrations/razorpay/client.js';
import { normalizeStatus } from '../src/integrations/courier/status-map.js';
import { shiprocketAdapter } from '../src/integrations/courier/shiprocket.js';

describe('razorpay webhook signature', () => {
  it('verifies hex HMAC of the raw body', () => {
    const body = Buffer.from('{"event":"payment_link.paid"}');
    const sig = createHmac('sha256', 'rzp_webhook_secret').update(body).digest('hex');
    expect(verifyRazorpayWebhook(body, sig, 'rzp_webhook_secret')).toBe(true);
    expect(verifyRazorpayWebhook(body, sig, 'wrong')).toBe(false);
  });
});

describe('courier status normalisation', () => {
  it.each([
    ['Delivered', 'delivered'],
    ['OUT FOR DELIVERY', 'out_for_delivery'],
    ['Undelivered - Customer Refused', 'ndr'],
    ['RTO Initiated', 'rto_initiated'],
    ['RTO Delivered', 'rto_delivered'],
    ['In Transit', 'in_transit'],
    ['Pickup Scheduled', 'created'],
  ])('%s -> %s', (raw, expected) => {
    expect(normalizeStatus(raw)).toBe(expected);
  });
});

describe('shiprocket adapter', () => {
  it('parses a webhook into a normalized event with a stable dedupe key', () => {
    const payload = {
      awb: 1234567890,
      order_id: '5550001',
      current_status: 'UNDELIVERED',
      current_timestamp: '2026-10-08 11:20:00',
      ndr_reason: 'Customer refused to accept',
    };
    const [a] = shiprocketAdapter.parseWebhook(payload);
    const [b] = shiprocketAdapter.parseWebhook(payload);
    expect(a).toMatchObject({ awb: '1234567890', orderRef: '5550001', status: 'ndr', reason: 'Customer refused to accept' });
    expect(a!.dedupeKey).toBe(b!.dedupeKey);
    expect(a!.occurredAt.toISOString()).toBe('2026-10-08T05:50:00.000Z');
  });

  it('verifies the webhook token header', () => {
    expect(shiprocketAdapter.verifyWebhook({ 'x-api-key': 'courier_secret' }, Buffer.from(''))).toBe(true);
    expect(shiprocketAdapter.verifyWebhook({ 'x-api-key': 'nope' }, Buffer.from(''))).toBe(false);
    expect(shiprocketAdapter.verifyWebhook({}, Buffer.from(''))).toBe(false);
  });

  it('ignores payloads without an AWB', () => {
    expect(shiprocketAdapter.parseWebhook({ current_status: 'Delivered' })).toEqual([]);
  });
});
