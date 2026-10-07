import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';
import { safeEqual } from '../lib/crypto.js';

/**
 * Internal/admin API auth via x-api-key. Replace with per-user auth (JWT/session)
 * when you build the seller dashboard; every route is still scoped by :storeId.
 */
export async function requireApiKey(req: FastifyRequest, reply: FastifyReply) {
  const key = req.headers['x-api-key'];
  const value = Array.isArray(key) ? key[0] : key;
  const ok = !!value && env().ADMIN_API_KEYS.some((k) => safeEqual(k, value));
  if (!ok) return reply.code(401).send({ error: 'unauthorized' });
}
