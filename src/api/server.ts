import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import rawBody from 'fastify-raw-body';
import { env, NotConfiguredError } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { healthRoutes } from './routes/health.js';
import { shopifyAuthRoutes } from './routes/shopify-auth.js';
import { webhookRoutes } from './routes/webhooks.js';
import { adminRoutes } from './routes/admin.js';
import { accountRoutes } from './routes/account.js';
import { publicRoutes } from './routes/public.js';
import { webRoutes } from './routes/web.js';
import { loadUser } from './session.js';

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export async function buildServer() {
  const app = Fastify({
    loggerInstance: logger,
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(sensible);
  await app.register(cookie);
  await app.register(rawBody, { field: 'rawBody', global: false, encoding: false, runFirst: true });
  await app.register(rateLimit, { max: 600, timeWindow: '1 minute', allowList: (req) => req.url.startsWith('/webhooks/') });

  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    if (req.url.startsWith('/app-api/') || req.url.startsWith('/auth/')) await loadUser(req);
  });
  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    reply.header('x-frame-options', 'DENY');
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    if (String(reply.getHeader('content-type') ?? '').includes('text/html')) reply.header('content-security-policy', CSP);
    if (env().NODE_ENV === 'production') reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
  });

  // Must be set before routes are registered: Fastify error handlers are inherited at registration time.
  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    const status = err.statusCode && (err.statusCode < 500 || err instanceof NotConfiguredError) ? err.statusCode : 500;
    if (status === 500) req.log.error({ err }, 'request failed');
    // 503 = an integration isn't configured yet: the message is safe and useful to show.
    reply.code(status).send({ error: status === 500 ? 'Something went wrong. Please try again.' : err.message });
  });

  await app.register(healthRoutes);
  await app.register(shopifyAuthRoutes);
  await app.register(webhookRoutes);
  await app.register(adminRoutes, { prefix: '/api' });
  await app.register(accountRoutes);
  await app.register(publicRoutes);
  await app.register(webRoutes);

  return app;
}
