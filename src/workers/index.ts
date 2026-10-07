import { Worker, type Processor } from 'bullmq';
import { closeDb } from '../db/client.js';
import { firstTimeSeen } from '../lib/idempotency.js';
import { logger } from '../lib/logger.js';
import { jobDuration, jobsProcessed } from '../lib/metrics.js';
import { closeQueues, type JobPayloads, type QueueName } from '../lib/queues.js';
import { closeRedis, redis } from '../lib/redis.js';
import { courierAdapter } from '../integrations/courier/registry.js';
import type { RazorpayEvent } from '../integrations/razorpay/client.js';
import { nudge } from '../modules/abandoned-cart/service.js';
import { evaluateCodOrder } from '../modules/cod-prepaid/service.js';
import { handleShopifyWebhook } from '../modules/order-sync/shopify-webhook-handler.js';
import { handleRazorpayEvent } from '../modules/payments/service.js';
import { evaluateShipment, expireCase } from '../modules/reroute/service.js';
import { applyCourierEvent } from '../modules/shipments/service.js';

type Handlers = { [N in QueueName]: (data: JobPayloads[N]) => Promise<unknown> };

const handlers: Handlers = {
  'shopify.webhook': async (d) => {
    if (!(await firstTimeSeen('shopify', d.topic, d.webhookId))) return;
    await handleShopifyWebhook(d.storeId, d.topic, d.payload);
  },
  'cod.evaluate': (d) => evaluateCodOrder(d.storeId, d.orderId),
  'cart.nudge': (d) => nudge(d.checkoutId),
  'courier.event': async (d) => {
    for (const ev of courierAdapter(d.courier).parseWebhook(d.payload)) await applyCourierEvent(d.courier, ev);
  },
  'reroute.evaluate': (d) => evaluateShipment(d.storeId, d.shipmentId),
  'reroute.expire': (d) => expireCase(d.caseId),
  'payment.event': (d) => handleRazorpayEvent(d.payload as RazorpayEvent),
};

/** Concurrency per queue — ReRoute is latency-sensitive (offers race the courier's RTO clock). */
const concurrency: Record<QueueName, number> = {
  'shopify.webhook': 20,
  'cod.evaluate': 10,
  'cart.nudge': 5,
  'courier.event': 20,
  'reroute.evaluate': 5,
  'reroute.expire': 5,
  'payment.event': 10,
};

const workers = (Object.keys(handlers) as QueueName[]).map((name) => {
  const processor: Processor = async (job) => {
    const end = jobDuration.startTimer({ queue: name });
    try {
      await (handlers[name] as (d: unknown) => Promise<unknown>)(job.data);
      jobsProcessed.inc({ queue: name, result: 'ok' });
    } catch (err) {
      jobsProcessed.inc({ queue: name, result: 'error' });
      logger.error({ err, queue: name, jobId: job.id, attempt: job.attemptsMade }, 'job failed');
      throw err;
    } finally {
      end();
    }
  };
  return new Worker(name, processor, { connection: redis(), concurrency: concurrency[name] });
});

logger.info({ queues: workers.length }, 'workers started');

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down workers');
  await Promise.all(workers.map((w) => w.close()));
  await closeQueues();
  await closeRedis();
  await closeDb();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
