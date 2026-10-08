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
import { addMember } from '../../modules/accounts/service.js';
import { appUrl, createClaimToken } from './account.js';

function parseState(raw: string | null): { shop: string; userId?: string } | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { shop?: unknown; userId?: unknown };
    if (typeof v.shop !== 'string') return null;
    return { shop: v.shop, userId: typeof v.userId === 'string' ? v.userId : undefined };
  } catch {
    return null;
  }
}

const STATE_TTL_S = 600;

export async function shopifyAuthRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { shop?: string } }>('/auth/shopify', async (req, reply) => {
    const shop = req.query.shop;
    if (!isValidShopDomain(shop)) return reply.code(400).send({ error: 'invalid shop domain' });
    const state = randomToken();
    await redis().set(`oauth:state:${state}`, JSON.stringify({ shop }), 'EX', STATE_TTL_S);
    return reply.redirect(buildInstallUrl(shop, state));
  });

  app.get<{ Querystring: Record<string, string> }>('/auth/shopify/callback', async (req, reply) => {
    const q = req.query;
    const shop = q.shop;
    if (!isValidShopDomain(shop) || !q.code || !q.state) return reply.code(400).send({ error: 'bad request' });
    if (!verifyOAuthHmac(q, env().SHOPIFY_API_SECRET)) return reply.code(401).send({ error: 'invalid hmac' });

    const rawState = await redis().getdel(`oauth:state:${q.state}`);
    const state = parseState(rawState);
    if (!state || state.shop !== shop) return reply.code(401).send({ error: 'invalid state' });

    const { accessToken, scope } = await exchangeCodeForToken(shop, q.code);
    const client = new ShopifyClient(shop, accessToken);
    const info = await client.shopInfo().catch(() => ({ name: shop }));
    const store = await upsertShopifyStore({ shop, accessToken, scopes: scope, name: info.name });
    await client.registerWebhooks(env().APP_URL);
    logger.info({ storeId: store.id, shop, linked: !!state.userId }, 'shopify store installed');

    if (state.userId) {
      await addMember(store.id, state.userId, 'owner');
      return reply.redirect(appUrl(`/app?connected=${encodeURIComponent(shop)}`));
    }
    // Installed from the Shopify App Store: let the seller sign up / log in, then claim the store.
    const claim = await createClaimToken(store.id);
    return reply.redirect(appUrl(`/app/connect?claim=${claim}`));
  });
}
