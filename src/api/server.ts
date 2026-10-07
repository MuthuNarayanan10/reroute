import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import rateLimit from '@fastify/rate-limit';
import rawBody from 'fastify-raw-body';
import { logger } from '../lib/logger.js';
import { healthRoutes } from './routes/health.js';
import { shopifyAuthRoutes } from './routes/shopify-auth.js';
import { webhookRoutes } from './routes/webhooks.js';
import { adminRoutes } from './routes/admin.js';

export async function buildServer() {
  const app = Fastify({
    loggerInstance: logger,
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(sensible);
  await app.register(rawBody, { field: 'rawBody', global: false, encoding: false, runFirst: true });
  await app.register(rateLimit, { max: 600, timeWindow: '1 minute', allowList: (req) => req.url.startsWith('/webhooks/') });

  await app.register(healthRoutes);
  await app.register(shopifyAuthRoutes);
  await app.register(webhookRoutes);
  await app.register(adminRoutes, { prefix: '/api' });

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    req.log.error({ err }, 'request failed');
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    reply.code(status).send({ error: status === 500 ? 'internal error' : err.message });
  });

  return app;
}
