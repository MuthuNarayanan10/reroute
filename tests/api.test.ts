import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildServer } from '../src/api/server.js';

let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('API security boundaries (no DB needed)', () => {
  it('serves liveness', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('rejects Shopify webhooks with a bad signature', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/shopify',
      headers: { 'content-type': 'application/json', 'x-shopify-hmac-sha256': 'bad', 'x-shopify-topic': 'orders/create' },
      payload: { id: 1 },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects Razorpay webhooks with a bad signature', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/razorpay',
      headers: { 'content-type': 'application/json', 'x-razorpay-signature': 'bad' },
      payload: { event: 'payment_link.paid' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 for unknown couriers', async () => {
    const res = await app.inject({ method: 'POST', url: '/webhooks/courier/unknown', payload: {} });
    expect(res.statusCode).toBe(404);
  });

  it('rejects admin API calls without an API key', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stores/00000000-0000-0000-0000-000000000000/orders' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects OAuth installs for non-Shopify domains', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/shopify?shop=evil.com' });
    expect(res.statusCode).toBe(400);
  });
});
