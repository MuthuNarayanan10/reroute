import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env.js';
import { randomToken } from '../../lib/crypto.js';
import { redis } from '../../lib/redis.js';
import { logger } from '../../lib/logger.js';
import {
  buildInstallUrl,
  exchangeCodeForToken,
  isValidShopDomain,
  verifyOAuthHmac,
} from '../../integrations/shopify/oauth.js';
import { ShopifyClient } from '../../integrations/shopify/client.js';
import { upsertShopifyStore } from '../../modules/stores/service.js';

const STATE_TTL_S = 600;

export async function shopifyAuthRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { shop?: string } }>('/auth/shopify', async (req, reply) => {
    const shop = req.query.shop;
    if (!isValidShopDomain(shop)) return reply.code(400).send({ error: 'invalid shop domain' });
    const state = randomToken();
    await redis().set(`oauth:state:${state}`, shop, 'EX', STATE_TTL_S);
    return reply.redirect(buildInstallUrl(shop, state));
  });

  app.get<{ Querystring: Record<string, string> }>('/auth/shopify/callback', async (req, reply) => {
    const q = req.query;
    const shop = q.shop;
    if (!isValidShopDomain(shop) || !q.code || !q.state) return reply.code(400).send({ error: 'bad request' });
    if (!verifyOAuthHmac(q, env().SHOPIFY_API_SECRET)) return reply.code(401).send({ error: 'invalid hmac' });

    const expectedShop = await redis().getdel(`oauth:state:${q.state}`);
    if (expectedShop !== shop) return reply.code(401).send({ error: 'invalid state' });

    const { accessToken, scope } = await exchangeCodeForToken(shop, q.code);
    const client = new ShopifyClient(shop, accessToken);
    const info = await client.shopInfo().catch(() => ({ name: shop }));
    const store = await upsertShopifyStore({ shop, accessToken, scopes: scope, name: info.name });
    await client.registerWebhooks(env().APP_URL);
    logger.info({ storeId: store.id, shop }, 'shopify store installed');

    return reply.redirect(`https://${shop}/admin/apps/${env().SHOPIFY_API_KEY}`);
  });
}
