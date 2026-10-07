import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { isValidShopDomain, verifyOAuthHmac } from '../src/integrations/shopify/oauth.js';
import { topicHeaderFromEnum, verifyShopifyWebhook } from '../src/integrations/shopify/webhooks.js';
import { detectPaymentMode, mapShopifyCheckout, mapShopifyOrder, type ShopifyOrderPayload } from '../src/integrations/shopify/mappers.js';

const secret = 'test_secret';

describe('shopify oauth', () => {
  it('accepts only *.myshopify.com domains', () => {
    expect(isValidShopDomain('my-store.myshopify.com')).toBe(true);
    expect(isValidShopDomain('evil.com')).toBe(false);
    expect(isValidShopDomain('my-store.myshopify.com.evil.com')).toBe(false);
  });

  it('verifies the OAuth query HMAC', () => {
    const params = { code: 'abc', shop: 'my-store.myshopify.com', state: 'xyz', timestamp: '1700000000' };
    const message = Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k as keyof typeof params]}`)
      .join('&');
    const hmac = createHmac('sha256', secret).update(message).digest('hex');
    expect(verifyOAuthHmac({ ...params, hmac }, secret)).toBe(true);
    expect(verifyOAuthHmac({ ...params, shop: 'other.myshopify.com', hmac }, secret)).toBe(false);
  });
});

describe('shopify webhooks', () => {
  it('verifies the raw-body HMAC', () => {
    const body = Buffer.from(JSON.stringify({ id: 1 }));
    const hmac = createHmac('sha256', secret).update(body).digest('base64');
    expect(verifyShopifyWebhook(body, hmac, secret)).toBe(true);
    expect(verifyShopifyWebhook(Buffer.from('{"id":2}'), hmac, secret)).toBe(false);
    expect(verifyShopifyWebhook(body, undefined, secret)).toBe(false);
  });

  it('maps GraphQL topic enums to header topics', () => {
    expect(topicHeaderFromEnum('ORDERS_CREATE')).toBe('orders/create');
    expect(topicHeaderFromEnum('APP_UNINSTALLED')).toBe('app/uninstalled');
  });
});

const baseOrder: ShopifyOrderPayload = {
  id: 5550001,
  name: '#1001',
  financial_status: 'pending',
  total_price: '1299.00',
  currency: 'INR',
  payment_gateway_names: ['Cash on Delivery (COD)'],
  customer: { id: 77, first_name: 'Priya', last_name: 'S', phone: '9876543210', sms_marketing_consent: { state: 'subscribed' } },
  shipping_address: {
    first_name: 'Priya',
    last_name: 'S',
    phone: '+91 98765 43210',
    address1: '12, 3rd Cross, Anna Nagar',
    city: 'Chennai',
    province: 'Tamil Nadu',
    zip: '600040',
    country_code: 'IN',
  },
  line_items: [{ variant_id: 111, sku: 'MUSLIN-BLUE', title: 'Muslin swaddle - Blue', quantity: 1, price: '1299.00' }],
  created_at: '2026-10-01T10:00:00+05:30',
  updated_at: '2026-10-01T10:00:05+05:30',
};

describe('shopify mappers', () => {
  it('maps a COD order into the normalized shape', () => {
    const o = mapShopifyOrder(baseOrder);
    expect(o.paymentMode).toBe('cod');
    expect(o.totalPaise).toBe(129900);
    expect(o.customer.phoneE164).toBe('+919876543210');
    expect(o.customer.whatsappConsent).toBe(true);
    expect(o.shippingAddress?.pincode).toBe('600040');
    expect(o.items[0]).toMatchObject({ variantId: '111', sku: 'MUSLIN-BLUE', unitPricePaise: 129900 });
  });

  it('detects prepaid and partial COD', () => {
    expect(detectPaymentMode({ payment_gateway_names: ['Razorpay'], financial_status: 'paid' })).toBe('prepaid');
    expect(detectPaymentMode({ payment_gateway_names: ['Razorpay', 'Cash on Delivery (COD)'] })).toBe('partial_cod');
    expect(detectPaymentMode({ payment_gateway_names: ['cash_on_delivery'], financial_status: 'paid' })).toBe('prepaid');
  });

  it('maps an abandoned checkout', () => {
    const c = mapShopifyCheckout({
      id: 9001,
      phone: '9123456780',
      buyer_accepts_marketing: true,
      shipping_address: { name: 'Arun K', address1: '45 Gandhi Street', city: 'Chennai', zip: '600041' },
      line_items: [{ variant_id: 111, sku: 'MUSLIN-BLUE', title: 'Muslin swaddle - Blue', quantity: 1, price: '1299.00' }],
      total_price: '1299.00',
      abandoned_checkout_url: 'https://store.example.com/recover/abc',
      created_at: '2026-10-01T09:00:00Z',
      updated_at: '2026-10-01T09:05:00Z',
    });
    expect(c.customerPhoneE164).toBe('+919123456780');
    expect(c.pincode).toBe('600041');
    expect(c.completed).toBe(false);
    expect(c.lines).toHaveLength(1);
  });
});
