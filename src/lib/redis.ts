import { Redis } from 'ioredis';
import { env } from '../config/env.js';

let client: Redis | undefined;

/** Shared Redis connection. BullMQ requires maxRetriesPerRequest = null. */
export function redis(): Redis {
  if (!client) {
    client = new Redis(env().REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true });
  }
  return client;
}

export async function closeRedis() {
  await client?.quit();
  client = undefined;
}
