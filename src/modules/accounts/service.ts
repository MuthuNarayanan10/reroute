import { and, eq, gt, lt } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { db } from '../../db/client.js';
import { sessions, storeMembers, stores, users, type MemberRole, type User } from '../../db/schema.js';
import { randomToken } from '../../lib/crypto.js';
import { audit } from '../../lib/audit.js';
import { dummyHash, hashPassword, verifyPassword } from './password.js';

export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

export class AccountError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function publicUser(u: User) {
  return { id: u.id, email: u.email, name: u.name };
}

export async function signup(input: { email: string; name: string; password: string }): Promise<User> {
  const email = normalizeEmail(input.email);
  const passwordHash = await hashPassword(input.password);
  const [row] = await db
    .insert(users)
    .values({ email, name: input.name.trim(), passwordHash })
    .onConflictDoNothing()
    .returning();
  if (!row) throw new AccountError('An account with this email already exists.', 409);
  await audit({ actor: `user:${row.id}`, action: 'user_signed_up', entity: 'user', entityId: row.id });
  return row;
}

/** Same error and same work for "no such email" and "wrong password" (no account enumeration). */
export async function authenticate(emailRaw: string, password: string): Promise<User> {
  const [u] = await db.select().from(users).where(eq(users.email, normalizeEmail(emailRaw))).limit(1);
  const ok = await verifyPassword(password, u?.passwordHash ?? (await dummyHash()));
  if (!u || !ok) throw new AccountError('Incorrect email or password.', 401);
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, u.id));
  return u;
}

export async function createSession(userId: string, meta: { userAgent?: string; ip?: string }): Promise<string> {
  const token = randomToken(32);
  await db.delete(sessions).where(and(eq(sessions.userId, userId), lt(sessions.expiresAt, new Date())));
  await db.insert(sessions).values({
    id: sha256(token),
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
    ip: meta.ip ?? null,
  });
  return token;
}

export async function userForSession(token: string | undefined): Promise<User | null> {
  if (!token || token.length > 128) return null;
  const [row] = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return row?.user ?? null;
}

export async function destroySession(token: string | undefined) {
  if (token) await db.delete(sessions).where(eq(sessions.id, sha256(token)));
}

export async function storesForUser(userId: string) {
  return db
    .select({
      id: stores.id,
      name: stores.name,
      platform: stores.platform,
      shopDomain: stores.shopDomain,
      status: stores.status,
      role: storeMembers.role,
    })
    .from(storeMembers)
    .innerJoin(stores, eq(stores.id, storeMembers.storeId))
    .where(eq(storeMembers.userId, userId))
    .orderBy(stores.createdAt);
}

export async function roleFor(userId: string, storeId: string): Promise<MemberRole | null> {
  const [m] = await db
    .select({ role: storeMembers.role })
    .from(storeMembers)
    .where(and(eq(storeMembers.userId, userId), eq(storeMembers.storeId, storeId)))
    .limit(1);
  return m?.role ?? null;
}

export async function addMember(storeId: string, userId: string, role: MemberRole = 'owner') {
  await db.insert(storeMembers).values({ storeId, userId, role }).onConflictDoNothing();
  await audit({ storeId, actor: `user:${userId}`, action: 'store_member_added', entity: 'store', entityId: storeId, data: { role } });
}
