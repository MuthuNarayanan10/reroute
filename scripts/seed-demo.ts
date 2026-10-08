/**
 * Seeds a realistic demo store + seller login so the dashboard can be explored without Shopify.
 *
 *   npm run seed:demo                       # demo@reroute.example / Reroute-demo-2026
 *   npm run seed:demo -- --email you@x.com --password 'Something-long-1'
 *   npm run seed:demo -- --reset            # wipe and re-create the demo store
 *
 * All names and phone numbers are fake. Refuses to run with NODE_ENV=production unless --force.
 */
import { and, eq } from 'drizzle-orm';
import { db, closeDb } from '../src/db/client.js';
import {
  checkouts,
  customers,
  defaultStoreSettings,
  orderItems,
  orders,
  pincodes,
  prepaidConversions,
  rerouteCases,
  rerouteOffers,
  shipments,
  stores,
  users,
  type ShippingAddress,
} from '../src/db/schema.js';
import { addMember, normalizeEmail } from '../src/modules/accounts/service.js';
import { hashPassword } from '../src/modules/accounts/password.js';
import { scoreCodRisk, istHour } from '../src/modules/cod-prepaid/risk.js';
import { applyDiscountBps } from '../src/lib/money.js';

const args = process.argv.slice(2);
const arg = (name: string, dflt: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : dflt;
};
if (process.env.NODE_ENV === 'production' && !args.includes('--force')) {
  console.error('Refusing to seed demo data with NODE_ENV=production (pass --force if you really mean it).');
  process.exit(1);
}
const EMAIL = normalizeEmail(arg('email', 'demo@reroute.example'));
const PASSWORD = arg('password', 'Reroute-demo-2026');
const DEMO_DOMAIN = 'demo-muslin-co';

// Deterministic PRNG so every seed looks the same.
let seed = 20261008;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
const chance = (p: number) => rand() < p;
const between = (a: number, b: number) => a + rand() * (b - a);

const PINS = [
  { pincode: '600040', lat: 13.085, lng: 80.2101, district: 'Chennai', city: 'Chennai', area: 'Anna Nagar', state: 'Tamil Nadu' },
  { pincode: '600101', lat: 13.0895, lng: 80.1985, district: 'Chennai', city: 'Chennai', area: 'Anna Nagar West', state: 'Tamil Nadu' },
  { pincode: '600017', lat: 13.0418, lng: 80.2341, district: 'Chennai', city: 'Chennai', area: 'T. Nagar', state: 'Tamil Nadu' },
  { pincode: '600020', lat: 13.0067, lng: 80.2571, district: 'Chennai', city: 'Chennai', area: 'Adyar', state: 'Tamil Nadu' },
  { pincode: '600042', lat: 12.9791, lng: 80.2209, district: 'Chennai', city: 'Chennai', area: 'Velachery', state: 'Tamil Nadu' },
  { pincode: '560001', lat: 12.9716, lng: 77.5946, district: 'Bengaluru', city: 'Bengaluru', area: 'MG Road', state: 'Karnataka' },
  { pincode: '560034', lat: 12.9352, lng: 77.6245, district: 'Bengaluru', city: 'Bengaluru', area: 'Koramangala', state: 'Karnataka' },
  { pincode: '560066', lat: 12.9698, lng: 77.75, district: 'Bengaluru', city: 'Bengaluru', area: 'Whitefield', state: 'Karnataka' },
  { pincode: '641002', lat: 11.0168, lng: 76.9558, district: 'Coimbatore', city: 'Coimbatore', area: 'R.S. Puram', state: 'Tamil Nadu' },
  { pincode: '625001', lat: 9.9252, lng: 78.1198, district: 'Madurai', city: 'Madurai', area: 'Town Hall', state: 'Tamil Nadu' },
  { pincode: '500081', lat: 17.4483, lng: 78.3915, district: 'Hyderabad', city: 'Hyderabad', area: 'Madhapur', state: 'Telangana' },
  { pincode: '400076', lat: 19.1197, lng: 72.9051, district: 'Mumbai', city: 'Mumbai', area: 'Powai', state: 'Maharashtra' },
] as const;
const PIN_RTO_BIAS: Record<string, number> = { '625001': 0.32, '641002': 0.2, '500081': 0.18, '600042': 0.16 };

const PRODUCTS = [
  { sku: 'MUSLIN-SWD-BLUE', variantId: '4101', title: 'Organic muslin swaddle – Ocean blue', price: 129900 },
  { sku: 'MUSLIN-SWD-SAND', variantId: '4102', title: 'Organic muslin swaddle – Sand', price: 129900 },
  { sku: 'BAMBOO-TOWEL', variantId: '4201', title: 'Bamboo hooded towel', price: 89900 },
  { sku: 'ONESIE-SET-3', variantId: '4301', title: 'Cotton onesie set (3-pack)', price: 149900 },
  { sku: 'BLANKET-KNIT', variantId: '4401', title: 'Knitted cotton baby blanket', price: 199900 },
  { sku: 'BURP-CLOTH-5', variantId: '4501', title: 'Muslin burp cloths (5-pack)', price: 59900 },
] as const;
const FIRST = ['Priya', 'Arun', 'Divya', 'Karthik', 'Meena', 'Rahul', 'Sneha', 'Vikram', 'Anjali', 'Suresh', 'Lakshmi', 'Ravi', 'Nisha', 'Ganesh', 'Kavya', 'Deepak'];
const LAST = ['S', 'K', 'R', 'M', 'N', 'P', 'V', 'Iyer', 'Nair', 'Reddy', 'Sharma', 'Rao'];
const NDR_REASONS = ['Customer refused delivery', 'Customer not reachable', 'Door locked', 'Customer asked for future delivery', 'Address incomplete'];

const DAY = 86400_000;
const now = Date.now();
const fakePhone = (n: number) => `+9190000${String(10000 + n).slice(-5)}`;

async function main() {
  // ---- user ----
  let [user] = await db.select().from(users).where(eq(users.email, EMAIL)).limit(1);
  if (!user) {
    [user] = await db.insert(users).values({ email: EMAIL, name: 'Demo Seller', passwordHash: await hashPassword(PASSWORD) }).returning();
  }
  if (!user) throw new Error('could not create user');

  // ---- store ----
  const [existing] = await db.select().from(stores).where(and(eq(stores.platform, 'custom'), eq(stores.shopDomain, DEMO_DOMAIN))).limit(1);
  if (existing && !args.includes('--reset')) {
    await addMember(existing.id, user.id, 'owner');
    console.log(`Demo store already exists (use --reset to rebuild). Log in as ${EMAIL}`);
    return;
  }
  if (existing) await db.delete(stores).where(eq(stores.id, existing.id));
  const [store] = await db
    .insert(stores)
    .values({ platform: 'custom', shopDomain: DEMO_DOMAIN, name: 'Muslin & Co. (demo)', status: 'active', settings: defaultStoreSettings, originPincode: '600040' })
    .returning();
  if (!store) throw new Error('could not create store');
  await addMember(store.id, user.id, 'owner');
  await db.insert(pincodes).values(PINS.map(({ pincode, lat, lng, district, state }) => ({ pincode, lat, lng, district, state }))).onConflictDoNothing();

  // ---- customers ----
  const custRows = await db
    .insert(customers)
    .values(
      Array.from({ length: 140 }, (_, i) => ({
        storeId: store.id,
        externalId: `demo-c-${i}`,
        phoneE164: fakePhone(i),
        name: `${pick(FIRST)} ${pick(LAST)}`,
        email: `customer${i}@example.com`,
        whatsappConsent: chance(0.7),
        ordersCount: 0,
      })),
    )
    .returning();

  // ---- orders ----
  let orderNo = 1000;
  let awbNo = 700100;
  const pinStats: Record<string, { delivered: number; rto: number }> = {};
  let made = { orders: 0, rescued: 0, live: 0 };

  for (let d = 34; d >= 0; d--) {
    const perDay = Math.round(between(6, 12) + (34 - d) * 0.12);
    for (let k = 0; k < perDay; k++) {
      orderNo++;
      const placedAt = new Date(now - d * DAY - between(0, 20) * 3600_000);
      const pin = pick(PINS);
      const cust = pick(custRows);
      const product = pick(PRODUCTS);
      const qty = chance(0.12) ? 2 : 1;
      const totalPaise = product.price * qty + (chance(0.5) ? 4900 : 0);
      const cod = chance(0.58);
      const address: ShippingAddress = {
        name: cust.name ?? 'Customer',
        phoneE164: cust.phoneE164,
        address1: chance(0.85) ? `${Math.floor(between(1, 200))}, ${pick(['2nd Main Road', 'Gandhi Street', 'Lake View Road', '4th Cross'])}` : 'near temple',
        address2: null,
        city: pin.city,
        state: pin.state,
        pincode: pin.pincode,
        country: 'IN',
      };

      const risk = cod
        ? scoreCodRisk(
            {
              orderValuePaise: totalPaise,
              customer: chance(0.4) ? { ordersCount: 3, deliveredCount: chance(0.8) ? 2 : 0, rtoCount: chance(0.2) ? 2 : 0 } : null,
              pincode: { delivered: 40, rto: Math.round(40 * (PIN_RTO_BIAS[pin.pincode] ?? 0.08)) },
              hasValidPhone: chance(0.96),
              address1: address.address1,
              maxLineQuantity: qty,
              placedHourIst: istHour(placedAt),
            },
            defaultStoreSettings,
          )
        : null;

      // Lifecycle by age
      const age = d;
      let status: 'open' | 'fulfilled' | 'delivered' | 'rto' | 'rerouted_out' | 'cancelled' = 'open';
      let shipStatus: 'in_transit' | 'out_for_delivery' | 'ndr' | 'delivered' | 'rto_delivered' | 'rerouted' | null = null;
      let rerouteOutcome: 'completed' | 'live' | 'expired' | 'no_match' | 'ineligible' | null = null;
      const failP = (PIN_RTO_BIAS[pin.pincode] ?? 0.1) * (cod ? 1.6 : 0.4) + (risk && risk.score > 60 ? 0.12 : 0);

      if (chance(0.03)) status = 'cancelled';
      else if (age >= 6) {
        if (chance(failP)) {
          // a failed first delivery: ReRoute tried
          if (cod && chance(0.62)) { status = 'rerouted_out'; shipStatus = 'delivered'; rerouteOutcome = 'completed'; }
          else { status = 'rto'; shipStatus = 'rto_delivered'; rerouteOutcome = cod ? pick(['expired', 'no_match'] as const) : 'ineligible'; }
        } else { status = 'delivered'; shipStatus = 'delivered'; }
      } else if (age >= 2) {
        status = 'fulfilled';
        if (chance(failP * 1.4)) {
          shipStatus = 'ndr';
          rerouteOutcome = cod && chance(0.7) ? (age <= 3 ? 'live' : 'completed') : 'no_match';
          if (rerouteOutcome === 'completed') { status = 'rerouted_out'; shipStatus = 'rerouted'; }
        } else shipStatus = chance(0.5) ? 'in_transit' : 'out_for_delivery';
      } else if (age === 1 && chance(0.6)) { status = 'fulfilled'; shipStatus = 'in_transit'; }

      const [o] = await db
        .insert(orders)
        .values({
          storeId: store.id,
          externalId: `demo-${orderNo}`,
          orderNumber: `#${orderNo}`,
          customerId: cust.id,
          paymentMode: cod ? 'cod' : 'prepaid',
          financialStatus: cod ? 'pending' : 'paid',
          status,
          totalPaise,
          shippingAddress: address,
          shippingPincode: pin.pincode,
          riskScore: risk?.score ?? null,
          riskAction: risk?.action ?? null,
          riskReasons: risk?.reasons ?? null,
          placedAt,
          sourceUpdatedAt: placedAt,
          createdAt: placedAt,
        })
        .returning();
      if (!o) continue;
      made.orders++;
      await db.insert(orderItems).values({ orderId: o.id, storeId: store.id, variantId: product.variantId, sku: product.sku, title: product.title, quantity: qty, unitPricePaise: product.price });

      // COD -> prepaid offers on risky open orders
      if (risk && (risk.action === 'nudge_prepaid' || risk.action === 'partial_cod') && chance(0.85)) {
        const discountPaise = Math.min(5000, Math.floor(totalPaise * 0.2));
        const paid = chance(0.34);
        await db.insert(prepaidConversions).values({
          storeId: store.id,
          orderId: o.id,
          riskScore: risk.score,
          discountPaise,
          amountPaise: totalPaise - discountPaise,
          paymentLinkId: `plink_demo_${orderNo}`,
          paymentLinkUrl: `https://rzp.io/l/demo${orderNo}`,
          status: paid ? 'paid' : age > 1 ? 'expired' : 'sent',
          sentAt: new Date(placedAt.getTime() + 60_000),
          paidAt: paid ? new Date(placedAt.getTime() + between(5, 120) * 60_000) : null,
        });
        if (paid && status !== 'rerouted_out') await db.update(orders).set({ paymentMode: 'prepaid', financialStatus: 'paid' }).where(eq(orders.id, o.id));
      }

      if (status === 'delivered' || status === 'rto') {
        const s = (pinStats[pin.pincode] ??= { delivered: 0, rto: 0 });
        s[status === 'delivered' ? 'delivered' : 'rto']++;
      }
      if (!shipStatus) continue;

      const ndrAt = new Date(Math.min(placedAt.getTime() + between(2, 4) * DAY, now - between(1, 6) * 3600_000));
      const [sh] = await db
        .insert(shipments)
        .values({
          storeId: store.id,
          orderId: o.id,
          courier: 'shiprocket',
          awb: `SR${awbNo++}`,
          status: shipStatus,
          ndrCount: rerouteOutcome ? 1 : 0,
          lastNdrReason: rerouteOutcome ? pick(NDR_REASONS) : null,
          destinationPincode: pin.pincode,
          lastEventAt: rerouteOutcome ? ndrAt : new Date(placedAt.getTime() + DAY),
          createdAt: new Date(placedAt.getTime() + 0.5 * DAY),
        })
        .returning();
      if (!sh || !rerouteOutcome) continue;

      const price = applyDiscountBps(product.price * qty, defaultStoreSettings.rerouteDiscountBps);
      const reason = {
        completed: null,
        live: null,
        expired: 'no buyer paid before deadline',
        no_match: 'no nearby buyer with matching cart',
        ineligible: 'only unpaid COD orders are rerouted (prepaid needs refund flow)',
      }[rerouteOutcome];
      const caseStatus = rerouteOutcome === 'live' ? 'offered' : rerouteOutcome;
      const doneAt = new Date(Math.min(ndrAt.getTime() + between(1, 5) * 3600_000, now - 600_000));
      const [rc] = await db
        .insert(rerouteCases)
        .values({
          storeId: store.id,
          shipmentId: sh.id,
          orderId: o.id,
          status: caseStatus,
          reason,
          offerPricePaise: caseStatus === 'ineligible' || caseStatus === 'no_match' ? null : price,
          deadlineAt: caseStatus === 'offered' ? new Date(now + between(1, 3.5) * 3600_000) : new Date(ndrAt.getTime() + 4 * 3600_000),
          savedPaise: caseStatus === 'completed' ? price : null,
          createdAt: ndrAt,
          updatedAt: caseStatus === 'completed' ? doneAt : ndrAt,
          newOrderExternalId: caseStatus === 'completed' ? `demo-rr-${orderNo}` : null,
        })
        .returning();
      if (!rc || caseStatus === 'ineligible' || caseStatus === 'no_match') continue;

      const nOffers = Math.floor(between(2, 5.99));
      let winner: string | null = null;
      for (let i = 0; i < nOffers; i++) {
        const buyerPin = pick(PINS.filter((p) => p.city === pin.city));
        const [co] = await db
          .insert(checkouts)
          .values({
            storeId: store.id,
            externalId: `demo-co-${orderNo}-${i}`,
            customerPhoneE164: fakePhone(500 + made.orders * 5 + i),
            customerName: `${pick(FIRST)} ${pick(LAST)}`,
            whatsappConsent: true,
            pincode: buyerPin.pincode,
            shippingAddress: { ...address, name: `${pick(FIRST)} ${pick(LAST)}`, pincode: buyerPin.pincode },
            lines: [{ variantId: product.variantId, sku: product.sku, title: product.title, quantity: qty, unitPricePaise: product.price }],
            totalPaise: product.price * qty,
            recoveryUrl: `https://example.com/recover/${orderNo}-${i}`,
            status: caseStatus === 'completed' && i === 0 ? 'used_for_reroute' : 'abandoned',
            abandonedAt: new Date(ndrAt.getTime() - between(2, 96) * 3600_000),
          })
          .returning();
        const isWinner = caseStatus === 'completed' && i === 0;
        const [off] = await db
          .insert(rerouteOffers)
          .values({
            caseId: rc.id,
            storeId: store.id,
            checkoutId: co?.id ?? null,
            phoneE164: co?.customerPhoneE164 ?? fakePhone(999),
            distanceKm: Math.round(between(0.6, 8.5) * 10) / 10,
            score: Math.round(between(0.3, 0.95) * 1000) / 1000,
            pricePaise: price,
            paymentLinkId: `plink_demo_rr_${orderNo}_${i}`,
            paymentLinkUrl: `https://rzp.io/l/demorr${orderNo}${i}`,
            status: caseStatus === 'offered' ? 'sent' : isWinner ? 'paid' : caseStatus === 'completed' ? 'superseded' : 'expired',
            sentAt: new Date(ndrAt.getTime() + 60_000),
            paidAt: isWinner ? doneAt : null,
          })
          .returning();
        if (isWinner && off) winner = off.id;
      }
      if (winner) await db.update(rerouteCases).set({ winningOfferId: winner, updatedAt: doneAt }).where(eq(rerouteCases.id, rc.id));
      if (caseStatus === 'completed') made.rescued++;
      if (caseStatus === 'offered') made.live++;
    }
  }

  console.log(
    `Seeded "${store.name}": ${made.orders} orders, ${made.rescued} parcels rescued, ${made.live} live ReRoute offers.\n` +
      `Log in at /app/login as ${EMAIL}${user.createdAt.getTime() > now - 60_000 ? ` / ${PASSWORD}` : ' (existing password)'}`,
  );
}

await main();
await closeDb();
