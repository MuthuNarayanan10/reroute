import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { defaultStoreSettings, orders, prepaidConversions } from '../../db/schema.js';
import { sql } from 'drizzle-orm';
import { getStore, updateSettings } from '../../modules/stores/service.js';
import { rerouteStats } from '../../modules/reroute/service.js';
import { registerShipment } from '../../modules/shipments/service.js';
import { listOrders, listRerouteCases, needsAction, overview } from '../../modules/insights/service.js';

export type AuthzResult = 'ok' | 'unauthorized' | 'forbidden' | 'not_found';
export interface StoreApiOptions {
  /** Decides whether this request may read (write=false) or change (write=true) the store. */
  authorize: (req: FastifyRequest, storeId: string, write: boolean) => Promise<AuthzResult>;
}

const storeParams = z.object({ storeId: z.string().uuid() });
const paging = { limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) };
const ordersQuery = z.object({ ...paging, view: z.enum(['all', 'cod', 'risky', 'rerouted']).default('all'), q: z.string().max(40).optional() });
const casesQuery = z.object({
  ...paging,
  status: z.enum(['evaluating', 'ineligible', 'no_match', 'offered', 'claimed', 'completed', 'expired', 'failed']).optional(),
});

const settingsPatch = z
  .object({
    codPrepaidEnabled: z.boolean(),
    nudgeThreshold: z.number().int().min(0).max(100),
    verifyThreshold: z.number().int().min(0).max(100),
    prepaidDiscountPaise: z.number().int().min(0).max(100_000),
    rerouteEnabled: z.boolean(),
    rerouteDiscountBps: z.number().int().min(0).max(5000),
    rerouteMinOrderPaise: z.number().int().min(0).max(10_000_000),
    rerouteExcludedSkus: z.array(z.string().trim().min(1).max(100)).max(1000),
  })
  .partial()
  .strict();

const shipmentBody = z.object({
  orderNumber: z.string().min(1).max(60).optional(),
  orderExternalId: z.string().min(1).max(60).optional(),
  courier: z.enum(['shiprocket']),
  awb: z.string().trim().min(3).max(40),
});

const ERR: Record<Exclude<AuthzResult, 'ok'>, [number, string]> = {
  unauthorized: [401, 'Please log in.'],
  forbidden: [403, 'You do not have permission to change this store.'],
  not_found: [404, 'Store not found.'],
};

/** Store-scoped API used by both the internal admin API (API key) and the seller dashboard (session). */
export async function storeApiRoutes(app: FastifyInstance, opts: StoreApiOptions) {
  app.addHook('preHandler', async (req, reply) => {
    const params = storeParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid store id.' });
    const write = req.method !== 'GET' && req.method !== 'HEAD';
    const result = await opts.authorize(req, params.data.storeId, write);
    if (result !== 'ok') {
      const [code, error] = ERR[result];
      return reply.code(code).send({ error });
    }
  });

  app.get<{ Params: { storeId: string } }>('/stores/:storeId', async (req) => {
    const store = (await getStore(req.params.storeId))!;
    return {
      id: store.id,
      name: store.name,
      platform: store.platform,
      shopDomain: store.shopDomain,
      status: store.status,
      settings: { ...defaultStoreSettings, ...store.settings },
      installedAt: store.installedAt,
    };
  });

  app.patch<{ Params: { storeId: string } }>('/stores/:storeId/settings', async (req, reply) => {
    const patch = settingsPatch.safeParse(req.body);
    if (!patch.success) return reply.code(400).send({ error: 'Invalid settings.', details: patch.error.flatten().fieldErrors });
    const store = (await getStore(req.params.storeId))!;
    const merged = { ...defaultStoreSettings, ...store.settings, ...patch.data };
    if (merged.verifyThreshold <= merged.nudgeThreshold) {
      return reply.code(400).send({ error: 'The partial-COD threshold must be higher than the prepaid-nudge threshold.' });
    }
    return { settings: await updateSettings(req.params.storeId, patch.data) };
  });

  app.get<{ Params: { storeId: string } }>('/stores/:storeId/overview', async (req) => {
    const [ov, action] = await Promise.all([overview(req.params.storeId), needsAction(req.params.storeId)]);
    return { ...ov, needsAction: action };
  });

  app.get<{ Params: { storeId: string } }>('/stores/:storeId/orders', async (req, reply) => {
    const q = ordersQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'Invalid query.' });
    return listOrders(req.params.storeId, q.data);
  });

  app.get<{ Params: { storeId: string } }>('/stores/:storeId/reroute/cases', async (req, reply) => {
    const q = casesQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'Invalid query.' });
    return listRerouteCases(req.params.storeId, q.data);
  });

  app.post<{ Params: { storeId: string } }>('/stores/:storeId/shipments', async (req, reply) => {
    const body = shipmentBody.safeParse(req.body);
    if (!body.success || (!body.data.orderNumber && !body.data.orderExternalId)) {
      return reply.code(400).send({ error: 'Give an order number and a valid AWB.' });
    }
    const { orderNumber, orderExternalId } = body.data;
    const normalizedNumber = orderNumber && (orderNumber.startsWith('#') ? orderNumber : `#${orderNumber}`);
    const [order] = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.storeId, req.params.storeId),
          orderExternalId ? eq(orders.externalId, orderExternalId) : eq(orders.orderNumber, normalizedNumber!),
        ),
      )
      .limit(1);
    if (!order) return reply.code(404).send({ error: 'No order with that number in this store.' });
    const shipment = await registerShipment({
      storeId: order.storeId,
      orderId: order.id,
      courier: body.data.courier,
      awb: body.data.awb,
      destinationPincode: order.shippingPincode,
    });
    if (!shipment) return reply.code(409).send({ error: 'That AWB is already registered.' });
    return reply.code(201).send({ shipment: { id: shipment.id, awb: shipment.awb, courier: shipment.courier, status: shipment.status } });
  });

  /** Kept for API compatibility (v0 admin clients). */
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
