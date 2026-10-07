import type { FastifyInstance } from 'fastify';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { orders, prepaidConversions, rerouteCases } from '../../db/schema.js';
import { maskName } from '../../lib/mask.js';
import { requireApiKey } from '../auth.js';
import { getStore, updateSettings } from '../../modules/stores/service.js';
import { rerouteStats } from '../../modules/reroute/service.js';
import { registerShipment } from '../../modules/shipments/service.js';

const storeParams = z.object({ storeId: z.string().uuid() });
const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });

const settingsPatch = z
  .object({
    codPrepaidEnabled: z.boolean(),
    nudgeThreshold: z.number().int().min(0).max(100),
    verifyThreshold: z.number().int().min(0).max(100),
    prepaidDiscountPaise: z.number().int().min(0),
    rerouteEnabled: z.boolean(),
    rerouteDiscountBps: z.number().int().min(0).max(5000),
    rerouteMinOrderPaise: z.number().int().min(0),
    rerouteExcludedSkus: z.array(z.string()).max(1000),
  })
  .partial()
  .strict();

const shipmentBody = z.object({
  orderExternalId: z.string().min(1),
  courier: z.string().min(1),
  awb: z.string().min(3),
});

/** Seller dashboard API. Every query is scoped by storeId. */
export async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireApiKey);

  app.addHook('preHandler', async (req, reply) => {
    const params = storeParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid storeId' });
    const store = await getStore(params.data.storeId);
    if (!store) return reply.code(404).send({ error: 'store not found' });
  });

  app.get<{ Params: { storeId: string } }>('/stores/:storeId', async (req) => {
    const store = await getStore(req.params.storeId);
    return { id: store!.id, name: store!.name, platform: store!.platform, status: store!.status, settings: store!.settings };
  });

  app.patch<{ Params: { storeId: string } }>('/stores/:storeId/settings', async (req, reply) => {
    const patch = settingsPatch.safeParse(req.body);
    if (!patch.success) return reply.code(400).send({ error: patch.error.flatten() });
    return { settings: await updateSettings(req.params.storeId, patch.data) };
  });

  app.get<{ Params: { storeId: string } }>('/stores/:storeId/orders', async (req) => {
    const { limit } = listQuery.parse(req.query);
    const rows = await db
      .select()
      .from(orders)
      .where(eq(orders.storeId, req.params.storeId))
      .orderBy(desc(orders.placedAt))
      .limit(limit);
    return rows.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      paymentMode: o.paymentMode,
      status: o.status,
      totalPaise: o.totalPaise,
      pincode: o.shippingPincode,
      customer: maskName(o.shippingAddress?.name),
      riskScore: o.riskScore,
      riskAction: o.riskAction,
      riskReasons: o.riskReasons,
      placedAt: o.placedAt,
    }));
  });

  app.post<{ Params: { storeId: string } }>('/stores/:storeId/shipments', async (req, reply) => {
    const body = shipmentBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.storeId, req.params.storeId), eq(orders.externalId, body.data.orderExternalId)))
      .limit(1);
    if (!order) return reply.code(404).send({ error: 'order not found' });
    const shipment = await registerShipment({
      storeId: order.storeId,
      orderId: order.id,
      courier: body.data.courier,
      awb: body.data.awb,
      destinationPincode: order.shippingPincode,
    });
    return reply.code(201).send({ shipment });
  });

  app.get<{ Params: { storeId: string } }>('/stores/:storeId/reroute/cases', async (req) => {
    const { limit } = listQuery.parse(req.query);
    return db
      .select()
      .from(rerouteCases)
      .where(eq(rerouteCases.storeId, req.params.storeId))
      .orderBy(desc(rerouteCases.createdAt))
      .limit(limit);
  });

  app.get<{ Params: { storeId: string } }>('/stores/:storeId/stats', async (req) => {
    const storeId = req.params.storeId;
    const [prepaid] = await db
      .select({
        sent: sql<number>`count(*)::int`,
        paid: sql<number>`count(*) filter (where ${prepaidConversions.status} = 'paid')::int`,
        paidValue: sql<number>`coalesce(sum(${prepaidConversions.amountPaise}) filter (where ${prepaidConversions.status} = 'paid'), 0)::int`,
      })
      .from(prepaidConversions)
      .where(eq(prepaidConversions.storeId, storeId));
    const reroute = await rerouteStats(storeId);
    const completed = reroute.find((r) => r.status === 'completed');
    return {
      codToPrepaid: { ...prepaid, conversionRate: prepaid && prepaid.sent ? prepaid.paid / prepaid.sent : 0 },
      reroute: { byStatus: reroute, parcelsRescued: completed?.count ?? 0, revenueRecoveredPaise: completed?.recovered ?? 0 },
    };
  });
}
