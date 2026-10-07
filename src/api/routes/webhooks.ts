import type { FastifyInstance, FastifyRequest } from 'fastify';
import { env } from '../../config/env.js';
import { webhooksReceived } from '../../lib/metrics.js';
import { enqueue } from '../../lib/queues.js';
import { verifyShopifyWebhook } from '../../integrations/shopify/webhooks.js';
import { verifyRazorpayWebhook } from '../../integrations/razorpay/client.js';
import { courierAdapter, hasCourier } from '../../integrations/courier/registry.js';
import { getActiveShopifyStoreByDomain } from '../../modules/stores/service.js';

function header(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

function rawBodyOf(req: FastifyRequest): Buffer {
  const raw = (req as FastifyRequest & { rawBody?: Buffer | string }).rawBody;
  if (!raw) throw new Error('raw body missing');
  return Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
}

/**
 * All webhooks follow the same contract: verify signature on the RAW body,
 * enqueue with a dedupe jobId, return 200 within milliseconds.
 */
export async function webhookRoutes(app: FastifyInstance) {
  app.post('/webhooks/shopify', { config: { rawBody: true } }, async (req, reply) => {
    const topic = header(req, 'x-shopify-topic') ?? 'unknown';
    const raw = rawBodyOf(req);
    if (!verifyShopifyWebhook(raw, header(req, 'x-shopify-hmac-sha256'), env().SHOPIFY_API_SECRET)) {
      webhooksReceived.inc({ source: 'shopify', topic, result: 'bad_signature' });
      return reply.code(401).send();
    }
    const shop = header(req, 'x-shopify-shop-domain');
    const store = shop ? await getActiveShopifyStoreByDomain(shop) : undefined;
    if (!store) {
      webhooksReceived.inc({ source: 'shopify', topic, result: 'unknown_store' });
      return reply.code(200).send(); // ack so Shopify stops retrying for removed stores
    }
    const webhookId = header(req, 'x-shopify-webhook-id') ?? `${topic}:${Date.now()}`;
    await enqueue(
      'shopify.webhook',
      { storeId: store.id, topic, webhookId, payload: req.body },
      { jobId: `shopify-${webhookId}` },
    );
    webhooksReceived.inc({ source: 'shopify', topic, result: 'queued' });
    return reply.code(200).send();
  });

  app.post('/webhooks/razorpay', { config: { rawBody: true } }, async (req, reply) => {
    const raw = rawBodyOf(req);
    if (!verifyRazorpayWebhook(raw, header(req, 'x-razorpay-signature'), env().RAZORPAY_WEBHOOK_SECRET)) {
      webhooksReceived.inc({ source: 'razorpay', topic: 'unknown', result: 'bad_signature' });
      return reply.code(401).send();
    }
    const body = req.body as { event?: string };
    const event = body.event ?? 'unknown';
    const eventId = header(req, 'x-razorpay-event-id');
    await enqueue('payment.event', { event, payload: req.body }, eventId ? { jobId: `rzp-${eventId}` } : {});
    webhooksReceived.inc({ source: 'razorpay', topic: event, result: 'queued' });
    return reply.code(200).send();
  });

  app.post<{ Params: { courier: string } }>('/webhooks/courier/:courier', { config: { rawBody: true } }, async (req, reply) => {
    const { courier } = req.params;
    if (!hasCourier(courier)) return reply.code(404).send();
    const raw = rawBodyOf(req);
    if (!courierAdapter(courier).verifyWebhook(req.headers, raw)) {
      webhooksReceived.inc({ source: courier, topic: 'tracking', result: 'bad_signature' });
      return reply.code(401).send();
    }
    await enqueue('courier.event', { courier, payload: req.body });
    webhooksReceived.inc({ source: courier, topic: 'tracking', result: 'queued' });
    return reply.code(200).send();
  });
}
