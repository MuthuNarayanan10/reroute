import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { leads } from '../../db/schema.js';
import { logger } from '../../lib/logger.js';
import { requireSameOrigin } from '../session.js';

const leadBody = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().max(20).optional().or(z.literal('')),
  company: z.string().trim().max(120).optional().or(z.literal('')),
  monthlyOrders: z.enum(['<500', '500-2k', '2k-10k', '10k+']).optional().or(z.literal('')),
  platform: z.enum(['shopify', 'woocommerce', 'custom', 'marketplace', 'other']).optional().or(z.literal('')),
  /** Honeypot: humans never see this field. */
  website: z.string().max(0).optional(),
});

export async function publicRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireSameOrigin);
  app.post('/public/leads', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = leadBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Please add your name and a valid email.' });
    const { website: _hp, ...d } = body.data;
    await db.insert(leads).values({
      name: d.name,
      email: d.email.toLowerCase(),
      phone: d.phone || null,
      company: d.company || null,
      monthlyOrders: d.monthlyOrders || null,
      platform: d.platform || null,
    });
    logger.info({ platform: d.platform, monthlyOrders: d.monthlyOrders }, 'new early-access lead');
    return reply.code(201).send({ ok: true });
  });
}
