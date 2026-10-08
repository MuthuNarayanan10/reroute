/**
 * Seller accounts, sessions, tenant isolation and roles against a REAL Postgres.
 * Runs only when INTEGRATION_DATABASE_URL is set (see package.json test:integration).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const DB_URL = vi.hoisted(() => {
  const url = process.env.INTEGRATION_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  process.env.APP_URL = 'https://app.example.com';
  return url;
});

// In-memory Redis stand-in (OAuth state + claim tokens) and no real queues.
const kv = vi.hoisted(() => new Map<string, string>());
vi.mock('../src/lib/redis.js', () => ({
  redis: () => ({
    set: async (k: string, v: string) => void kv.set(k, v),
    getdel: async (k: string) => {
      const v = kv.get(k) ?? null;
      kv.delete(k);
      return v;
    },
    ping: async () => 'PONG',
  }),
  closeRedis: async () => {},
}));
vi.mock('../src/lib/queues.js', () => ({ enqueue: vi.fn(), queue: vi.fn(), closeQueues: vi.fn() }));

import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, closeDb } from '../src/db/client.js';
import * as s from '../src/db/schema.js';
import { buildServer } from '../src/api/server.js';
import { addMember } from '../src/modules/accounts/service.js';
import { createClaimToken } from '../src/api/routes/account.js';
import { redactStore } from '../src/modules/privacy/service.js';

const run = describe.skipIf(!DB_URL);
const ORIGIN = { origin: 'https://app.example.com' };
let app: Awaited<ReturnType<typeof buildServer>>;
let storeA = '';
let storeB = '';

function cookieFrom(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : String(raw ?? '');
  return first.split(';')[0]!;
}

async function signup(email: string, password = 'Very-secure-pass-1') {
  const res = await app.inject({ method: 'POST', url: '/auth/signup', headers: ORIGIN, payload: { name: 'Seller', email, password, acceptTerms: true } });
  return { res, cookie: cookieFrom(res) };
}

async function makeStore(domain: string) {
  const [st] = await db.insert(s.stores).values({ platform: 'custom', shopDomain: domain, name: domain, settings: s.defaultStoreSettings }).returning();
  return st!.id;
}

run('seller accounts, sessions and tenant isolation', () => {
  let alice = '';
  let bob = '';
  let aliceId = '';
  let bobId = '';

  beforeAll(async () => {
    await db.execute(sql`drop schema if exists public cascade; create schema public; drop schema if exists drizzle cascade;`);
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    app = await buildServer();
    await app.ready();
    storeA = await makeStore('store-a');
    storeB = await makeStore('store-b');
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  it('rejects weak passwords and missing terms', async () => {
    const weak = await app.inject({ method: 'POST', url: '/auth/signup', headers: ORIGIN, payload: { name: 'A', email: 'a@x.com', password: 'short', acceptTerms: true } });
    expect(weak.statusCode).toBe(400);
    const noTerms = await app.inject({ method: 'POST', url: '/auth/signup', headers: ORIGIN, payload: { name: 'A', email: 'a@x.com', password: 'Very-secure-pass-1' } });
    expect(noTerms.statusCode).toBe(400);
  });

  it('signs up with an httpOnly session cookie and blocks duplicate emails', async () => {
    const a = await signup('Alice@Example.com ');
    expect(a.res.statusCode).toBe(201);
    expect(String(a.res.headers['set-cookie'])).toMatch(/rr_session=.+HttpOnly.+SameSite=Lax/i);
    alice = a.cookie;
    aliceId = a.res.json().user.id;
    expect(a.res.json().user.email).toBe('alice@example.com');
    const dup = await signup('alice@example.com');
    expect(dup.res.statusCode).toBe(409);
    const b = await signup('bob@example.com');
    bob = b.cookie;
    bobId = b.res.json().user.id;
  });

  it('stores only a hash of the session token and a scrypt password hash', async () => {
    const token = alice.split('=')[1]!;
    const rows = await db.select().from(s.sessions);
    expect(rows.some((r) => r.id === token)).toBe(false);
    const [u] = await db.select().from(s.users).where(eq(s.users.id, aliceId));
    expect(u!.passwordHash).toMatch(/^scrypt\$32768\$8\$1\$/);
  });

  it('requires a session for the app API', async () => {
    expect((await app.inject({ method: 'GET', url: '/app-api/me' })).statusCode).toBe(401);
    const me = await app.inject({ method: 'GET', url: '/app-api/me', headers: { cookie: alice } });
    expect(me.statusCode).toBe(200);
    expect(me.json().stores).toEqual([]);
  });

  it('gives the same error for unknown email and wrong password', async () => {
    const wrong = await app.inject({ method: 'POST', url: '/auth/login', headers: ORIGIN, payload: { email: 'alice@example.com', password: 'nope-nope-1' } });
    const unknown = await app.inject({ method: 'POST', url: '/auth/login', headers: ORIGIN, payload: { email: 'ghost@example.com', password: 'nope-nope-1' } });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json().error).toBe(unknown.json().error);
    const ok = await app.inject({ method: 'POST', url: '/auth/login', headers: ORIGIN, payload: { email: 'ALICE@example.com', password: 'Very-secure-pass-1' } });
    expect(ok.statusCode).toBe(200);
  });

  it('isolates stores: members see their store, never anyone else’s', async () => {
    await addMember(storeA, aliceId, 'owner');
    await addMember(storeB, bobId, 'owner');
    const mine = await app.inject({ method: 'GET', url: `/app-api/stores/${storeA}/overview`, headers: { cookie: alice } });
    expect(mine.statusCode).toBe(200);
    expect(mine.json()).toMatchObject({ rescued: { parcels: 0 }, needsAction: { ndr: [], risky: [] } });
    expect(mine.json().daily).toHaveLength(30);
    for (const path of ['overview', 'orders', 'reroute/cases', '']) {
      const theirs = await app.inject({ method: 'GET', url: `/app-api/stores/${storeB}/${path}`, headers: { cookie: alice } });
      expect(theirs.statusCode).toBe(404);
    }
    const patch = await app.inject({ method: 'PATCH', url: `/app-api/stores/${storeB}/settings`, headers: { cookie: alice, ...ORIGIN }, payload: { rerouteEnabled: false } });
    expect(patch.statusCode).toBe(404);
  });

  it('lets viewers read but not change settings', async () => {
    await addMember(storeA, bobId, 'viewer');
    expect((await app.inject({ method: 'GET', url: `/app-api/stores/${storeA}/orders`, headers: { cookie: bob } })).statusCode).toBe(200);
    const res = await app.inject({ method: 'PATCH', url: `/app-api/stores/${storeA}/settings`, headers: { cookie: bob, ...ORIGIN }, payload: { rerouteEnabled: false } });
    expect(res.statusCode).toBe(403);
  });

  it('validates and saves settings', async () => {
    const bad = await app.inject({ method: 'PATCH', url: `/app-api/stores/${storeA}/settings`, headers: { cookie: alice, ...ORIGIN }, payload: { nudgeThreshold: 80, verifyThreshold: 60 } });
    expect(bad.statusCode).toBe(400);
    const unknownField = await app.inject({ method: 'PATCH', url: `/app-api/stores/${storeA}/settings`, headers: { cookie: alice, ...ORIGIN }, payload: { hacker: true } });
    expect(unknownField.statusCode).toBe(400);
    const ok = await app.inject({ method: 'PATCH', url: `/app-api/stores/${storeA}/settings`, headers: { cookie: alice, ...ORIGIN }, payload: { rerouteDiscountBps: 1500, rerouteExcludedSkus: ['PERISHABLE'] } });
    expect(ok.statusCode).toBe(200);
    const [st] = await db.select().from(s.stores).where(eq(s.stores.id, storeA));
    expect(st!.settings).toMatchObject({ rerouteDiscountBps: 1500, rerouteExcludedSkus: ['PERISHABLE'] });
  });

  it('blocks cross-site state changes (CSRF)', async () => {
    const res = await app.inject({ method: 'PATCH', url: `/app-api/stores/${storeA}/settings`, headers: { cookie: alice, origin: 'https://evil.example' }, payload: { rerouteEnabled: false } });
    expect(res.statusCode).toBe(403);
    const login = await app.inject({ method: 'POST', url: '/auth/login', headers: { origin: 'https://evil.example' }, payload: { email: 'a@x.com', password: 'x' } });
    expect(login.statusCode).toBe(403);
  });

  it('starts Shopify connect with OAuth state bound to the user', async () => {
    const bad = await app.inject({ method: 'POST', url: '/app-api/shopify/connect', headers: { cookie: alice, ...ORIGIN }, payload: { shop: 'evil.com/x' } });
    expect(bad.statusCode).toBe(400);
    const res = await app.inject({ method: 'POST', url: '/app-api/shopify/connect', headers: { cookie: alice, ...ORIGIN }, payload: { shop: 'muslin-co' } });
    expect(res.statusCode).toBe(200);
    const url = new URL(res.json().url);
    expect(url.host).toBe('muslin-co.myshopify.com');
    const state = JSON.parse(kv.get(`oauth:state:${url.searchParams.get('state')}`)!);
    expect(state).toEqual({ shop: 'muslin-co.myshopify.com', userId: aliceId });
  });

  it('claims a store installed from the Shopify App Store, once', async () => {
    const storeC = await makeStore('store-c');
    const token = await createClaimToken(storeC);
    const res = await app.inject({ method: 'POST', url: '/app-api/stores/claim', headers: { cookie: alice, ...ORIGIN }, payload: { token } });
    expect(res.statusCode).toBe(200);
    expect(res.json().stores.find((x: { id: string }) => x.id === storeC)).toMatchObject({ role: 'owner' });
    const again = await app.inject({ method: 'POST', url: '/app-api/stores/claim', headers: { cookie: bob, ...ORIGIN }, payload: { token } });
    expect(again.statusCode).toBe(410);
  });

  it('records early-access leads and rejects bots', async () => {
    const ok = await app.inject({ method: 'POST', url: '/public/leads', headers: ORIGIN, payload: { name: 'Muthu', email: 'Muthu@Brand.in', monthlyOrders: '500-2k', platform: 'shopify' } });
    expect(ok.statusCode).toBe(201);
    const bot = await app.inject({ method: 'POST', url: '/public/leads', headers: ORIGIN, payload: { name: 'x', email: 'x@y.com', website: 'spam.example' } });
    expect(bot.statusCode).toBe(400);
    const rows = await db.select().from(s.leads);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.email).toBe('muthu@brand.in');
  });

  it('deletes a store with all its data (Shopify shop/redact)', async () => {
    const [o] = await db.insert(s.orders).values({ storeId: storeB, externalId: 'x1', paymentMode: 'cod', totalPaise: 1000, placedAt: new Date(), sourceUpdatedAt: new Date() }).returning();
    const [sh] = await db.insert(s.shipments).values({ storeId: storeB, orderId: o!.id, courier: 'shiprocket', awb: 'AWB1' }).returning();
    const [co] = await db.insert(s.checkouts).values({ storeId: storeB, externalId: 'c1', lines: [], totalPaise: 1000, abandonedAt: new Date() }).returning();
    const [rc] = await db.insert(s.rerouteCases).values({ storeId: storeB, shipmentId: sh!.id, orderId: o!.id }).returning();
    await db.insert(s.rerouteOffers).values({ caseId: rc!.id, storeId: storeB, checkoutId: co!.id, phoneE164: '+919000000000', distanceKm: 1, score: 1, pricePaise: 900 });
    await redactStore(storeB);
    expect(await db.select().from(s.orders).where(eq(s.orders.storeId, storeB))).toHaveLength(0);
    expect(await db.select().from(s.stores).where(eq(s.stores.id, storeB))).toHaveLength(0);
  });

  it('logs out by destroying the session server-side', async () => {
    const out = await app.inject({ method: 'POST', url: '/auth/logout', headers: { cookie: alice, ...ORIGIN } });
    expect(out.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/app-api/me', headers: { cookie: alice } })).statusCode).toBe(401);
  });
});
