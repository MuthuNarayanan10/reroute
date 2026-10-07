/**
 * End-to-end flow against a REAL Postgres (external APIs are faked).
 * Runs only when INTEGRATION_DATABASE_URL is set:
 *   INTEGRATION_DATABASE_URL=postgres://reroute:reroute@localhost:5432/reroute_test npm run test:integration
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';

const DB_URL = vi.hoisted(() => {
  const url = process.env.INTEGRATION_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  process.env.ADMIN_API_KEYS = 'test-admin-key';
  return url;
});

const enqueued = vi.hoisted(() => [] as Array<{ name: string; data: unknown; opts?: { jobId?: string } }>);
vi.mock('../src/lib/queues.js', () => ({
  enqueue: vi.fn(async (name: string, data: unknown, opts?: { jobId?: string }) => {
    enqueued.push({ name, data, opts });
  }),
  queue: vi.fn(),
  closeQueues: vi.fn(),
}));

// ---- fake external APIs (Razorpay, WhatsApp, Shopify, Shiprocket) ----
const calls: Array<{ url: string; body: any }> = [];
let linkSeq = 0;
let orderSeq = 9000;
async function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ url, body });
  const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });

  if (url.includes('razorpay.com/v1/payment_links') && !url.endsWith('/cancel')) {
    linkSeq++;
    return json({ id: `plink_${linkSeq}`, short_url: `https://rzp.io/l/${linkSeq}`, status: 'created' });
  }
  if (url.includes('razorpay.com')) return json({});
  if (url.includes('graph.facebook.com')) return json({ messages: [{ id: 'wamid.1' }] });
  if (url.includes('shiprocket')) return json(url.includes('auth/login') ? { token: 'sr_token' } : { status: true });
  if (url.includes('myshopify.com')) {
    const q: string = body?.query ?? '';
    if (q.includes('draftOrderCreate')) return json({ data: { draftOrderCreate: { draftOrder: { id: 'gid://shopify/DraftOrder/1' }, userErrors: [] } } });
    if (q.includes('draftOrderComplete')) {
      orderSeq++;
      return json({ data: { draftOrderComplete: { draftOrder: { order: { id: `gid://shopify/Order/${orderSeq}`, name: `#${orderSeq}` } }, userErrors: [] } } });
    }
    if (q.includes('orderCancel')) return json({ data: { orderCancel: { orderCancelUserErrors: [] } } });
    if (q.includes('orderMarkAsPaid')) return json({ data: { orderMarkAsPaid: { userErrors: [] } } });
    if (q.includes('tagsAdd')) return json({ data: { tagsAdd: { userErrors: [] } } });
    return json({ data: {} });
  }
  return new Response('not mocked', { status: 500 });
}
vi.stubGlobal('fetch', fakeFetch);

import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, closeDb } from '../src/db/client.js';
import * as s from '../src/db/schema.js';
import { upsertShopifyStore } from '../src/modules/stores/service.js';
import { handleShopifyWebhook } from '../src/modules/order-sync/shopify-webhook-handler.js';
import { evaluateCodOrder } from '../src/modules/cod-prepaid/service.js';
import { applyCourierEvent, registerShipment } from '../src/modules/shipments/service.js';
import { evaluateShipment, handleOfferPaid } from '../src/modules/reroute/service.js';
import { redactCustomer } from '../src/modules/privacy/service.js';
import { shiprocketAdapter } from '../src/integrations/courier/shiprocket.js';
import { buildServer } from '../src/api/server.js';

const run = describe.skipIf(!DB_URL);

let storeId = '';
const shopifyCalls = () => calls.filter((c) => c.url.includes('myshopify.com')).map((c) => c.body.query as string);

run('full flow: order -> COD risk -> NDR -> ReRoute -> delivered', () => {
  beforeAll(async () => {
    await db.execute(sql`drop schema if exists public cascade; create schema public; drop schema if exists drizzle cascade;`);
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    await db.insert(s.pincodes).values([
      { pincode: '600040', lat: 13.085, lng: 80.2101, district: 'Chennai', state: 'Tamil Nadu' }, // Anna Nagar
      { pincode: '600101', lat: 13.0895, lng: 80.1985, district: 'Chennai', state: 'Tamil Nadu' }, // Anna Nagar West
      { pincode: '600017', lat: 13.0418, lng: 80.2341, district: 'Chennai', state: 'Tamil Nadu' }, // T. Nagar
      { pincode: '560001', lat: 12.9716, lng: 77.5946, district: 'Bengaluru', state: 'Karnataka' },
    ]);
    const store = await upsertShopifyStore({ shop: 'babybrand.myshopify.com', accessToken: 'shpat_test', scopes: 'read_orders', name: 'Baby Brand' });
    storeId = store.id;
  });

  afterAll(async () => {
    await closeDb();
  });

  const checkout = (id: number, phone: string, zip: string, updated: string) => ({
    id,
    phone,
    buyer_accepts_marketing: true,
    shipping_address: { name: `Buyer ${id}`, phone, address1: `${id}, 2nd Avenue, Block C`, city: 'Chennai', province: 'Tamil Nadu', zip },
    line_items: [{ variant_id: 111, sku: 'MUSLIN-BLUE', title: 'Muslin swaddle - Blue', quantity: 1, price: '1299.00' }],
    total_price: '1299.00',
    abandoned_checkout_url: `https://babybrand.example.com/recover/${id}`,
    created_at: updated,
    updated_at: updated,
  });

  const order = (updatedAt: string) => ({
    id: 5550001,
    name: '#1001',
    financial_status: 'pending',
    total_price: '1348.00', // includes ₹49 shipping
    currency: 'INR',
    payment_gateway_names: ['Cash on Delivery (COD)'],
    customer: { id: 77, first_name: 'Priya', last_name: 'S', phone: '9876543210' },
    shipping_address: { first_name: 'Priya', last_name: 'S', phone: '9876543210', address1: '12, 3rd Cross, Anna Nagar', city: 'Chennai', province: 'Tamil Nadu', zip: '600040', country_code: 'IN' },
    line_items: [{ variant_id: 111, sku: 'MUSLIN-BLUE', title: 'Muslin swaddle - Blue', quantity: 1, price: '1299.00' }],
    created_at: '2026-10-06T10:00:00+05:30',
    updated_at: updatedAt,
  });

  it('ingests abandoned checkouts (the ReRoute buyer pool)', async () => {
    const recent = new Date(Date.now() - 3 * 3600_000).toISOString();
    const older = new Date(Date.now() - 30 * 3600_000).toISOString();
    await handleShopifyWebhook(storeId, 'checkouts/create', checkout(9001, '9123456780', '600101', recent)); // near, fresh
    await handleShopifyWebhook(storeId, 'checkouts/create', checkout(9002, '9123456781', '600017', older)); // ~6km, older
    await handleShopifyWebhook(storeId, 'checkouts/create', checkout(9003, '9123456782', '560001', recent)); // Bengaluru: too far
    const rows = await db.select().from(s.checkouts).where(eq(s.checkouts.storeId, storeId));
    expect(rows).toHaveLength(3);
    expect(enqueued.filter((j) => j.name === 'cart.nudge')).toHaveLength(3);
  });

  it('syncs a COD order idempotently and queues risk evaluation once', async () => {
    await handleShopifyWebhook(storeId, 'orders/create', order('2026-10-06T10:00:05+05:30'));
    await handleShopifyWebhook(storeId, 'orders/create', order('2026-10-06T10:00:05+05:30')); // duplicate
    await handleShopifyWebhook(storeId, 'orders/updated', order('2026-10-06T09:00:00+05:30')); // stale, out of order
    const rows = await db.select().from(s.orders).where(eq(s.orders.storeId, storeId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ paymentMode: 'cod', totalPaise: 134800, shippingPincode: '600040' });
    expect(enqueued.filter((j) => j.name === 'cod.evaluate')).toHaveLength(1);
    const items = await db.select().from(s.orderItems);
    expect(items).toHaveLength(1);
  });

  it('scores COD risk and stores explainable reasons', async () => {
    const [o] = await db.select().from(s.orders);
    await evaluateCodOrder(storeId, o!.id);
    const [scored] = await db.select().from(s.orders);
    expect(scored!.riskScore).toBeTypeOf('number');
    expect(scored!.riskReasons?.length).toBeGreaterThan(0);
  });

  it('opens a ReRoute case on the first NDR only (duplicate courier events ignored)', async () => {
    const [o] = await db.select().from(s.orders);
    await registerShipment({ storeId, orderId: o!.id, courier: 'shiprocket', awb: 'SR123', destinationPincode: '600040' });
    const payload = { awb: 'SR123', order_id: '5550001', current_status: 'UNDELIVERED', current_timestamp: '2026-10-08 11:20:00', ndr_reason: 'Customer refused delivery' };
    for (const ev of shiprocketAdapter.parseWebhook(payload)) await applyCourierEvent('shiprocket', ev);
    for (const ev of shiprocketAdapter.parseWebhook(payload)) await applyCourierEvent('shiprocket', ev); // duplicate
    const [sh] = await db.select().from(s.shipments);
    expect(sh).toMatchObject({ status: 'ndr', ndrCount: 1 });
    expect(enqueued.filter((j) => j.name === 'reroute.evaluate')).toHaveLength(1);
  });

  it('matches nearby buyers and sends prepaid offers ranked by proximity + recency', async () => {
    const [sh] = await db.select().from(s.shipments);
    const rc = await evaluateShipment(storeId, sh!.id);
    expect(rc?.status).toBe('offered');
    expect(rc?.offerPricePaise).toBe(116900); // ₹1299 items - 10%, shipping free
    const offers = await db.select().from(s.rerouteOffers).orderBy(sql`${s.rerouteOffers.score} desc`);
    expect(offers.map((x) => x.phoneE164)).toEqual(['+919123456780', '+919123456781']); // Bengaluru excluded
    expect(offers.every((x) => x.paymentLinkId)).toBe(true);
    expect(calls.filter((c) => c.url.includes('graph.facebook.com')).length).toBeGreaterThanOrEqual(2);
    // Evaluating again is a no-op.
    expect(await evaluateShipment(storeId, sh!.id)).toBeNull();
  });

  it('first payer wins: parcel redirected, new paid order created, original cancelled', async () => {
    const offers = await db.select().from(s.rerouteOffers).orderBy(sql`${s.rerouteOffers.score} desc`);
    const [winner] = offers;
    calls.length = 0;
    await handleOfferPaid(winner!.id, 'pay_winner', 116900);

    const [rc] = await db.select().from(s.rerouteCases);
    const [sh] = await db.select().from(s.shipments);
    const [orig] = await db.select().from(s.orders).where(eq(s.orders.externalId, '5550001'));
    const [co] = await db.select().from(s.checkouts).where(eq(s.checkouts.externalId, '9001'));
    expect(rc).toMatchObject({ status: 'completed', winningOfferId: winner!.id, savedPaise: 116900 });
    expect(rc!.newOrderExternalId).toBeTruthy();
    expect(sh).toMatchObject({ status: 'rerouted', destinationPincode: '600101' });
    expect(orig!.status).toBe('rerouted_out');
    expect(co!.status).toBe('used_for_reroute');

    const q = shopifyCalls();
    expect(q.some((x) => x.includes('draftOrderCreate'))).toBe(true);
    expect(q.some((x) => x.includes('orderCancel'))).toBe(true);
    const draft = calls.find((c) => c.body?.query?.includes('draftOrderCreate'));
    expect(draft!.body.variables.input.appliedDiscount.value).toBe(130); // ₹1299 - ₹1169
    expect(calls.some((c) => c.url.includes('shiprocket') && c.url.includes('/ndr/SR123/action'))).toBe(true);
    // Losing offer's link cancelled.
    expect(calls.some((c) => c.url.includes('payment_links/') && c.url.endsWith('/cancel'))).toBe(true);
  });

  it('replaying the winning payment does not create a second order', async () => {
    const [rc] = await db.select().from(s.rerouteCases);
    calls.length = 0;
    await handleOfferPaid(rc!.winningOfferId!, 'pay_winner', 116900);
    expect(shopifyCalls().filter((x) => x.includes('draftOrderCreate'))).toHaveLength(0);
  });

  it('a late second payer is refunded automatically', async () => {
    const [rc] = await db.select().from(s.rerouteCases);
    const [loser] = (await db.select().from(s.rerouteOffers)).filter((o) => o.id !== rc!.winningOfferId);
    calls.length = 0;
    await handleOfferPaid(loser!.id, 'pay_late', 116900);
    expect(calls.some((c) => c.url.includes('/payments/pay_late/refund'))).toBe(true);
    const [after] = await db.select().from(s.rerouteOffers).where(eq(s.rerouteOffers.id, loser!.id));
    expect(after!.status).toBe('refunded');
  });

  it('delivery to the new buyer closes the loop and teaches the risk model', async () => {
    const payload = { awb: 'SR123', order_id: '5550001', current_status: 'DELIVERED', current_timestamp: '2026-10-09 10:00:00' };
    for (const ev of shiprocketAdapter.parseWebhook(payload)) await applyCourierEvent('shiprocket', ev);
    const [sh] = await db.select().from(s.shipments);
    const [orig] = await db.select().from(s.orders).where(eq(s.orders.externalId, '5550001'));
    const [cust] = await db.select().from(s.customers).where(eq(s.customers.phoneE164, '+919876543210'));
    expect(sh!.status).toBe('delivered');
    expect(orig!.status).toBe('rerouted_out');
    expect(cust!.rtoCount).toBe(1); // the original refusing buyer is remembered
  });

  it('admin API returns store-scoped stats with an API key', async () => {
    const app = await buildServer();
    const res = await app.inject({ method: 'GET', url: `/api/stores/${storeId}/stats`, headers: { 'x-api-key': 'test-admin-key' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().reroute).toMatchObject({ parcelsRescued: 1, revenueRecoveredPaise: 116900 });

    const list = await app.inject({ method: 'GET', url: `/api/stores/${storeId}/orders`, headers: { 'x-api-key': 'test-admin-key' } });
    expect(list.json()[0].customer).toBe('P. S.'); // masked
    await app.close();
  });

  it('accepts a correctly signed Razorpay webhook and queues it with a dedupe id', async () => {
    const app = await buildServer();
    const payload = JSON.stringify({ event: 'payment_link.paid', payload: {} });
    const sig = createHmac('sha256', 'rzp_webhook_secret').update(payload).digest('hex');
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/razorpay',
      headers: { 'content-type': 'application/json', 'x-razorpay-signature': sig, 'x-razorpay-event-id': 'evt_1' },
      payload,
    });
    expect(res.statusCode).toBe(200);
    expect(enqueued.at(-1)).toMatchObject({ name: 'payment.event', opts: { jobId: 'rzp-evt_1' } });
    await app.close();
  });

  it('redacts a customer on request (DPDP / Shopify customers/redact)', async () => {
    await redactCustomer(storeId, { phone: '9123456781' });
    const [co] = await db.select().from(s.checkouts).where(eq(s.checkouts.externalId, '9002'));
    expect(co!.customerPhoneE164).toBeNull();
    expect(co!.shippingAddress).toBeNull();
  });
});
