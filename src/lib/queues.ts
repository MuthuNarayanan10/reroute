import { Queue, type JobsOptions } from 'bullmq';
import { redis } from './redis.js';

/** Every queue name and its job payload type, in one place. */
export interface JobPayloads {
  'shopify.webhook': { storeId: string; topic: string; webhookId: string; payload: unknown };
  'cod.evaluate': { storeId: string; orderId: string };
  'cart.nudge': { storeId: string; checkoutId: string };
  'courier.event': { courier: string; payload: unknown };
  'reroute.evaluate': { storeId: string; shipmentId: string };
  'reroute.expire': { caseId: string };
  'payment.event': { event: string; payload: unknown };
}

export type QueueName = keyof JobPayloads;

const defaultJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: { age: 24 * 3600, count: 10_000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

const queues = new Map<QueueName, Queue>();

export function queue<N extends QueueName>(name: N): Queue<JobPayloads[N]> {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, { connection: redis(), defaultJobOptions });
    queues.set(name, q);
  }
  return q as Queue<JobPayloads[N]>;
}

/** Enqueue with an optional jobId so duplicates are dropped by BullMQ (idempotency). */
export async function enqueue<N extends QueueName>(
  name: N,
  data: JobPayloads[N],
  opts: JobsOptions = {},
): Promise<void> {
  await (queue(name) as Queue).add(name, data, opts);
}

export async function closeQueues() {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
}
