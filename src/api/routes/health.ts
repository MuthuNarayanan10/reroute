import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { redis } from '../../lib/redis.js';
import { registry } from '../../lib/metrics.js';
import { integrations } from '../../config/env.js';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({ ok: true }));

  app.get('/ready', async (_req, reply) => {
    try {
      await db.execute(sql`select 1`);
      await redis().ping();
      return { ok: true, integrations: integrations() };
    } catch (err) {
      return reply.code(503).send({ ok: false, error: (err as Error).message });
    }
  });

  app.get('/metrics', async (_req, reply) => {
    reply.header('content-type', registry.contentType);
    return registry.metrics();
  });
}
