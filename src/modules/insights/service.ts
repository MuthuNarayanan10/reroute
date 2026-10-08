import { and, count, desc, eq, gte, ilike, inArray, sql, type SQL } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { orders, prepaidConversions, rerouteCases, rerouteOffers, shipments } from '../../db/schema.js';
import { maskName } from '../../lib/mask.js';

const IST = 'Asia/Kolkata';

/** Start of the current calendar month in IST, as a UTC Date. */
export function istMonthStart(now = new Date()): Date {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - 330 * 60_000);
}

export async function overview(storeId: string, now = new Date()) {
  const monthStart = istMonthStart(now);
  const since30 = new Date(now.getTime() - 30 * 86400_000);

  const [rescued] = await db
    .select({
      parcels: sql<number>`count(*)::int`,
      paise: sql<number>`coalesce(sum(${rerouteCases.savedPaise}), 0)::int`,
      monthParcels: sql<number>`count(*) filter (where ${rerouteCases.updatedAt} >= ${monthStart})::int`,
      monthPaise: sql<number>`coalesce(sum(${rerouteCases.savedPaise}) filter (where ${rerouteCases.updatedAt} >= ${monthStart}), 0)::int`,
    })
    .from(rerouteCases)
    .where(and(eq(rerouteCases.storeId, storeId), eq(rerouteCases.status, 'completed'), gte(rerouteCases.updatedAt, since30)));
  const [live] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(rerouteCases)
    .where(and(eq(rerouteCases.storeId, storeId), eq(rerouteCases.status, 'offered')));

  const [prepaid] = await db
    .select({
      sent: sql<number>`count(*)::int`,
      paid: sql<number>`count(*) filter (where ${prepaidConversions.status} = 'paid')::int`,
      paidPaise: sql<number>`coalesce(sum(${prepaidConversions.amountPaise}) filter (where ${prepaidConversions.status} = 'paid'), 0)::int`,
    })
    .from(prepaidConversions)
    .where(and(eq(prepaidConversions.storeId, storeId), gte(prepaidConversions.sentAt, since30)));

  const [ord] = await db
    .select({
      total: sql<number>`count(*)::int`,
      cod: sql<number>`count(*) filter (where ${orders.paymentMode} = 'cod')::int`,
      delivered: sql<number>`count(*) filter (where ${orders.status} = 'delivered')::int`,
      rto: sql<number>`count(*) filter (where ${orders.status} = 'rto')::int`,
      rerouted: sql<number>`count(*) filter (where ${orders.status} = 'rerouted_out')::int`,
      gmvPaise: sql<number>`coalesce(sum(${orders.totalPaise}), 0)::bigint`,
    })
    .from(orders)
    .where(and(eq(orders.storeId, storeId), gte(orders.placedAt, since30)));

  // Daily ₹ rescued for the last 30 IST days (zero-filled).
  const daily = await db.execute<{ day: string; paise: number; parcels: number }>(sql`
    with days as (
      select generate_series(
        (date_trunc('day', now() at time zone ${IST}) - interval '29 days')::date,
        (date_trunc('day', now() at time zone ${IST}))::date,
        interval '1 day'
      )::date as day
    )
    select to_char(d.day, 'YYYY-MM-DD') as day,
           coalesce(sum(c.saved_paise), 0)::int as paise,
           count(c.id)::int as parcels
    from days d
    left join reroute_cases c
      on c.store_id = ${storeId}
     and c.status = 'completed'
     and (c.updated_at at time zone ${IST})::date = d.day
    group by d.day
    order by d.day`);

  const outcomes = (ord?.delivered ?? 0) + (ord?.rto ?? 0) + (ord?.rerouted ?? 0);
  return {
    monthStart,
    /** Last 30 days (hero KPI) + this calendar month (IST). */
    rescued: {
      parcels: rescued?.parcels ?? 0,
      paise: rescued?.paise ?? 0,
      monthParcels: rescued?.monthParcels ?? 0,
      monthPaise: rescued?.monthPaise ?? 0,
      liveOffers: live?.n ?? 0,
    },
    prepaid: {
      sent: prepaid?.sent ?? 0,
      paid: prepaid?.paid ?? 0,
      paidPaise: prepaid?.paidPaise ?? 0,
      rate: prepaid && prepaid.sent ? prepaid.paid / prepaid.sent : 0,
    },
    orders30d: {
      total: ord?.total ?? 0,
      cod: ord?.cod ?? 0,
      codShare: ord && ord.total ? ord.cod / ord.total : 0,
      gmvPaise: Number(ord?.gmvPaise ?? 0),
      // Rescued parcels are failed first deliveries, but they did not become RTO.
      rtoRate: outcomes ? (ord?.rto ?? 0) / outcomes : 0,
    },
    daily: daily.rows,
  };
}

/** Things a seller should look at now: live NDRs and risky COD orders not yet dispatched. */
export async function needsAction(storeId: string) {
  const ndr = await db
    .select({
      shipmentId: shipments.id,
      awb: shipments.awb,
      reason: shipments.lastNdrReason,
      at: shipments.lastEventAt,
      orderNumber: orders.orderNumber,
      pincode: orders.shippingPincode,
      totalPaise: orders.totalPaise,
      caseStatus: rerouteCases.status,
    })
    .from(shipments)
    .innerJoin(orders, eq(orders.id, shipments.orderId))
    .leftJoin(rerouteCases, eq(rerouteCases.shipmentId, shipments.id))
    .where(and(eq(shipments.storeId, storeId), eq(shipments.status, 'ndr')))
    .orderBy(desc(shipments.lastEventAt))
    .limit(8);

  const risky = await db
    .select({
      orderId: orders.id,
      orderNumber: orders.orderNumber,
      riskScore: orders.riskScore,
      riskAction: orders.riskAction,
      totalPaise: orders.totalPaise,
      pincode: orders.shippingPincode,
      at: orders.placedAt,
    })
    .from(orders)
    .where(
      and(
        eq(orders.storeId, storeId),
        eq(orders.status, 'open'),
        eq(orders.paymentMode, 'cod'),
        inArray(orders.riskAction, ['nudge_prepaid', 'partial_cod', 'verify', 'block_cod']),
      ),
    )
    .orderBy(desc(orders.riskScore), desc(orders.placedAt))
    .limit(8);

  return {
    ndr: ndr.map((n) => ({ ...n, kind: 'ndr' as const })),
    risky: risky.map((r) => ({ ...r, kind: 'risky' as const })),
  };
}

export type OrderView = 'all' | 'cod' | 'risky' | 'rerouted';

export async function listOrders(storeId: string, opts: { view: OrderView; q?: string; limit: number; offset: number }) {
  const where: SQL[] = [eq(orders.storeId, storeId)];
  if (opts.view === 'cod') where.push(eq(orders.paymentMode, 'cod'));
  if (opts.view === 'risky') where.push(inArray(orders.riskAction, ['nudge_prepaid', 'partial_cod', 'verify', 'block_cod']));
  if (opts.view === 'rerouted') where.push(eq(orders.status, 'rerouted_out'));
  if (opts.q) where.push(ilike(orders.orderNumber, `%${opts.q.replace(/[%_\\]/g, '')}%`));
  const cond = and(...where);

  const [total] = await db.select({ n: count() }).from(orders).where(cond);
  const rows = await db
    .select({
      order: orders,
      prepaidStatus: prepaidConversions.status,
    })
    .from(orders)
    .leftJoin(prepaidConversions, eq(prepaidConversions.orderId, orders.id))
    .where(cond)
    .orderBy(desc(orders.placedAt))
    .limit(opts.limit)
    .offset(opts.offset);

  return {
    total: total?.n ?? 0,
    items: rows.map(({ order: o, prepaidStatus }) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      paymentMode: o.paymentMode,
      status: o.status,
      totalPaise: o.totalPaise,
      pincode: o.shippingPincode,
      city: o.shippingAddress?.city ?? null,
      customer: maskName(o.shippingAddress?.name),
      riskScore: o.riskScore,
      riskAction: o.riskAction,
      riskReasons: o.riskReasons,
      prepaidOffer: prepaidStatus ?? null,
      placedAt: o.placedAt,
    })),
  };
}

export async function listRerouteCases(storeId: string, opts: { status?: string; limit: number; offset: number }) {
  const where: SQL[] = [eq(rerouteCases.storeId, storeId)];
  if (opts.status) where.push(sql`${rerouteCases.status} = ${opts.status}`);
  const cond = and(...where);
  const [total] = await db.select({ n: count() }).from(rerouteCases).where(cond);
  const rows = await db
    .select({
      id: rerouteCases.id,
      status: rerouteCases.status,
      reason: rerouteCases.reason,
      offerPricePaise: rerouteCases.offerPricePaise,
      savedPaise: rerouteCases.savedPaise,
      deadlineAt: rerouteCases.deadlineAt,
      createdAt: rerouteCases.createdAt,
      updatedAt: rerouteCases.updatedAt,
      newOrderExternalId: rerouteCases.newOrderExternalId,
      orderNumber: orders.orderNumber,
      orderTotalPaise: orders.totalPaise,
      fromPincode: orders.shippingPincode,
      awb: shipments.awb,
      courier: shipments.courier,
      offersSent: sql<number>`(select count(*)::int from ${rerouteOffers} o where o.case_id = ${rerouteCases.id})`,
      winnerKm: sql<number | null>`(select o.distance_km from ${rerouteOffers} o where o.id = ${rerouteCases.winningOfferId})`,
    })
    .from(rerouteCases)
    .innerJoin(orders, eq(orders.id, rerouteCases.orderId))
    .innerJoin(shipments, eq(shipments.id, rerouteCases.shipmentId))
    .where(cond)
    .orderBy(desc(rerouteCases.createdAt))
    .limit(opts.limit)
    .offset(opts.offset);

  const byStatus = await db
    .select({ status: rerouteCases.status, n: sql<number>`count(*)::int` })
    .from(rerouteCases)
    .where(eq(rerouteCases.storeId, storeId))
    .groupBy(rerouteCases.status);

  return { total: total?.n ?? 0, items: rows, byStatus };
}
