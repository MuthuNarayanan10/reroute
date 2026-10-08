import type { FastifyInstance, FastifyReply } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

const API_PREFIXES = ['/api/', '/app-api/', '/auth/', '/webhooks/', '/public/', '/health', '/ready', '/metrics'];

/** Serves the marketing site (static HTML) and the seller dashboard (SPA under /app). */
export async function webRoutes(app: FastifyInstance) {
  const root = path.resolve(process.cwd(), env().WEB_DIST);
  if (!existsSync(path.join(root, 'index.html'))) {
    logger.warn({ root }, 'web build not found — run `npm run build:web` to serve the website');
    return;
  }

  await app.register(fastifyStatic, {
    root,
    index: false,
    wildcard: false, // a route per file found at boot: unknown paths fall through to our 404 handler
    setHeaders(res, filePath) {
      res.setHeader(
        'cache-control',
        filePath.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
    },
  });

  const page = (file: string) => (_req: unknown, reply: FastifyReply) => reply.header('cache-control', 'no-cache').sendFile(file);
  app.get('/', page('index.html'));
  app.get('/privacy', page('privacy.html'));
  app.get('/terms', page('terms.html'));
  app.get('/app', page('app.html'));
  app.get('/app/*', page('app.html'));
  // With wildcard:false, @fastify/static registers one GET route per built file (assets, brand, favicon).

  app.setNotFoundHandler((req, reply) => {
    const isApi = API_PREFIXES.some((p) => req.url.startsWith(p));
    if (req.method === 'GET' && !isApi && req.headers.accept?.includes('text/html')) {
      return reply.code(404).header('cache-control', 'no-cache').sendFile('404.html');
    }
    return reply.code(404).send({ error: 'Not found.' });
  });
}
