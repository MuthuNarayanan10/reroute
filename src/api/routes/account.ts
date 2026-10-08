import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { randomToken } from '../../lib/crypto.js';
import { redis } from '../../lib/redis.js';
import { buildInstallUrl, isValidShopDomain } from '../../integrations/shopify/oauth.js';
import {
  AccountError,
  addMember,
  authenticate,
  createSession,
  destroySession,
  publicUser,
  roleFor,
  signup,
  storesForUser,
} from '../../modules/accounts/service.js';
import { passwordProblem } from '../../modules/accounts/password.js';
import { getStore } from '../../modules/stores/service.js';
import { db } from '../../db/client.js';
import { storeMembers } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { SESSION_COOKIE, requireSameOrigin, requireUser, sessionCookieOptions } from '../session.js';
import { storeApiRoutes } from './store-api.js';

const AUTH_LIMIT = { rateLimit: { max: 10, timeWindow: '1 minute' } };
const signupBody = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(200),
  acceptTerms: z.literal(true),
});
const loginBody = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(200) });
const connectBody = z.object({ shop: z.string().trim().toLowerCase() });
const claimBody = z.object({ token: z.string().min(10).max(100) });

export const OAUTH_STATE_TTL_S = 600;
export const CLAIM_TTL_S = 3600;

export async function accountRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireSameOrigin);

  // ---------- auth ----------
  app.post('/auth/signup', { config: AUTH_LIMIT }, async (req, reply) => {
    const body = signupBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Fill in your name, a valid email, a password and accept the terms.' });
    const problem = passwordProblem(body.data.password);
    if (problem) return reply.code(400).send({ error: problem });
    try {
      const user = await signup(body.data);
      const token = await createSession(user.id, { userAgent: req.headers['user-agent'], ip: req.ip });
      reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions());
      return reply.code(201).send({ user: publicUser(user), stores: [] });
    } catch (err) {
      if (err instanceof AccountError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  app.post('/auth/login', { config: AUTH_LIMIT }, async (req, reply) => {
    const body = loginBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Enter your email and password.' });
    try {
      const user = await authenticate(body.data.email, body.data.password);
      const token = await createSession(user.id, { userAgent: req.headers['user-agent'], ip: req.ip });
      reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions());
      return { user: publicUser(user), stores: await storesForUser(user.id) };
    } catch (err) {
      if (err instanceof AccountError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  app.post('/auth/logout', async (req, reply) => {
    await destroySession(req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  // ---------- seller app API ----------
  await app.register(async (sub) => {
    sub.addHook('preHandler', requireUser);

    sub.get('/me', async (req) => ({ user: publicUser(req.user!), stores: await storesForUser(req.user!.id) }));

    /** Start "Connect Shopify" from the dashboard: returns the Shopify OAuth URL bound to this user. */
    sub.post('/shopify/connect', async (req, reply) => {
      const body = connectBody.safeParse(req.body);
      const shop = body.success ? (body.data.shop.endsWith('.myshopify.com') ? body.data.shop : `${body.data.shop}.myshopify.com`) : '';
      if (!isValidShopDomain(shop)) return reply.code(400).send({ error: 'Enter your store address, e.g. your-store.myshopify.com' });
      const state = randomToken();
      await redis().set(`oauth:state:${state}`, JSON.stringify({ shop, userId: req.user!.id }), 'EX', OAUTH_STATE_TTL_S);
      return { url: buildInstallUrl(shop, state) };
    });

    /** Link a store installed from the Shopify App Store (no session at install time) to this account. */
    sub.post('/stores/claim', async (req, reply) => {
      const body = claimBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'Invalid link.' });
      const storeId = await redis().getdel(`claim:${body.data.token}`);
      if (!storeId || !(await getStore(storeId))) return reply.code(410).send({ error: 'This link has expired. Reinstall the app from Shopify.' });
      if (!(await roleFor(req.user!.id, storeId))) {
        const existing = await db.select().from(storeMembers).where(eq(storeMembers.storeId, storeId)).limit(1);
        await addMember(storeId, req.user!.id, existing.length ? 'admin' : 'owner');
      }
      return { stores: await storesForUser(req.user!.id) };
    });

    await sub.register(storeApiRoutes, {
      authorize: async (req, storeId, write) => {
        if (!req.user) return 'unauthorized';
        const role = await roleFor(req.user.id, storeId);
        if (!role) return 'not_found'; // never reveal that another seller's store exists
        if (write && role === 'viewer') return 'forbidden';
        return 'ok';
      },
    });
  }, { prefix: '/app-api' });
}

/** Creates a one-time token that lets the next logged-in user claim a freshly installed store. */
export async function createClaimToken(storeId: string): Promise<string> {
  const token = randomToken(24);
  await redis().set(`claim:${token}`, storeId, 'EX', CLAIM_TTL_S);
  return token;
}

export function appUrl(path: string) {
  return `${env().APP_URL.replace(/\/$/, '')}${path}`;
}
