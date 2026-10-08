import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env.js';
import { safeEqual } from '../../lib/crypto.js';
import { getStore } from '../../modules/stores/service.js';
import { storeApiRoutes } from './store-api.js';

/** Internal/ops API: x-api-key auth, full access to every store. Not for sellers. */
export async function adminRoutes(app: FastifyInstance) {
  await app.register(storeApiRoutes, {
    authorize: async (req, storeId) => {
      const h = req.headers['x-api-key'];
      const key = Array.isArray(h) ? h[0] : h;
      if (!key || !env().ADMIN_API_KEYS.some((k) => safeEqual(k, key))) return 'unauthorized';
      return (await getStore(storeId)) ? 'ok' : 'not_found';
    },
  });
}
