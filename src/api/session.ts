import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';
import type { User } from '../db/schema.js';
import { SESSION_TTL_MS, userForSession } from '../modules/accounts/service.js';

export const SESSION_COOKIE = 'rr_session';

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: env().NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}

/** Resolves the logged-in user (if any) from the session cookie. */
export async function loadUser(req: FastifyRequest) {
  req.user = await userForSession(req.cookies[SESSION_COOKIE]);
}

export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  if (!req.user) return reply.code(401).send({ error: 'Please log in.' });
}

function allowedOrigins(): Set<string> {
  const e = env();
  return new Set([new URL(e.APP_URL).origin, ...e.ALLOWED_ORIGINS.map((o) => new URL(o).origin)]);
}

/**
 * CSRF defence for cookie-authenticated routes: state-changing requests must come from our own origin.
 * (SameSite=Lax cookies + JSON-only bodies + this check.)
 */
export async function requireSameOrigin(req: FastifyRequest, reply: FastifyReply) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
  const origin = req.headers.origin;
  if (origin) {
    if (!allowedOrigins().has(origin)) return reply.code(403).send({ error: 'Cross-site request blocked.' });
    return;
  }
  if (req.headers['sec-fetch-site'] === 'cross-site') return reply.code(403).send({ error: 'Cross-site request blocked.' });
}
