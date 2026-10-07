import { sql } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// ---------- enums ----------
export const platformEnum = pgEnum('platform', ['shopify', 'woocommerce', 'custom']);
export const storeStatusEnum = pgEnum('store_status', ['active', 'uninstalled', 'suspended']);
export const paymentModeEnum = pgEnum('payment_mode', ['cod', 'prepaid', 'partial_cod']);
export const orderStatusEnum = pgEnum('order_status', [
  'open',
  'cancelled',
  'fulfilled',
  'delivered',
  'rto',
  'rerouted_out',
]);
export const riskActionEnum = pgEnum('risk_action', ['allow', 'nudge_prepaid', 'partial_cod', 'verify', 'block_cod']);
export const checkoutStatusEnum = pgEnum('checkout_status', ['abandoned', 'recovered', 'used_for_reroute']);
export const shipmentStatusEnum = pgEnum('shipment_status', [
  'created',
  'in_transit',
  'out_for_delivery',
  'ndr',
  'rto_initiated',
  'rto_delivered',
  'delivered',
  'rerouted',
]);
export const conversionStatusEnum = pgEnum('conversion_status', ['sent', 'paid', 'expired', 'failed']);
export const rerouteCaseStatusEnum = pgEnum('reroute_case_status', [
  'evaluating',
  'ineligible',
  'no_match',
  'offered',
  'claimed',
  'completed',
  'expired',
  'failed',
]);
export const rerouteOfferStatusEnum = pgEnum('reroute_offer_status', [
  'sent',
  'paid',
  'expired',
  'superseded',
  'refunded',
  'failed',
]);

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export interface StoreSettings {
  codPrepaidEnabled: boolean;
  /** Risk score at/above which we send a prepaid nudge. */
  nudgeThreshold: number;
  /** Risk score at/above which we ask for partial COD / verification. */
  verifyThreshold: number;
  prepaidDiscountPaise: number;
  rerouteEnabled: boolean;
  rerouteDiscountBps: number;
  rerouteMinOrderPaise: number;
  /** SKUs that must never be rerouted (perishables, custom-made, intimate wear...). */
  rerouteExcludedSkus: string[];
}

export const defaultStoreSettings: StoreSettings = {
  codPrepaidEnabled: true,
  nudgeThreshold: 45,
  verifyThreshold: 75,
  prepaidDiscountPaise: 5000,
  rerouteEnabled: true,
  rerouteDiscountBps: 1000,
  rerouteMinOrderPaise: 30000,
  rerouteExcludedSkus: [],
};

// ---------- tenants ----------
export const stores = pgTable(
  'stores',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    platform: platformEnum('platform').notNull(),
    shopDomain: text('shop_domain').notNull(),
    name: text('name'),
    accessTokenEnc: text('access_token_enc'),
    scopes: text('scopes'),
    status: storeStatusEnum('status').notNull().default('active'),
    settings: jsonb('settings').$type<StoreSettings>().notNull().default(defaultStoreSettings),
    originPincode: text('origin_pincode'),
    installedAt: timestamp('installed_at', { withTimezone: true }).notNull().defaultNow(),
    uninstalledAt: timestamp('uninstalled_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex('stores_platform_domain_uq').on(t.platform, t.shopDomain)],
);

// ---------- geo reference ----------
export const pincodes = pgTable(
  'pincodes',
  {
    pincode: text('pincode').primaryKey(),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    district: text('district'),
    state: text('state'),
  },
  (t) => [index('pincodes_lat_lng_idx').on(t.lat, t.lng)],
);

/** Per-store delivery outcomes by pincode — feeds the COD risk model. */
export const pincodeStats = pgTable(
  'pincode_stats',
  {
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    pincode: text('pincode').notNull(),
    delivered: integer('delivered').notNull().default(0),
    rto: integer('rto').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.storeId, t.pincode] })],
);

// ---------- customers ----------
export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    externalId: text('external_id'),
    phoneE164: text('phone_e164'),
    email: text('email'),
    name: text('name'),
    whatsappConsent: boolean('whatsapp_consent').notNull().default(false),
    ordersCount: integer('orders_count').notNull().default(0),
    deliveredCount: integer('delivered_count').notNull().default(0),
    rtoCount: integer('rto_count').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('customers_store_phone_uq').on(t.storeId, t.phoneE164),
    index('customers_store_external_idx').on(t.storeId, t.externalId),
  ],
);

// ---------- orders ----------
export interface ShippingAddress {
  name: string;
  phoneE164: string | null;
  address1: string;
  address2?: string | null;
  city: string;
  state: string;
  pincode: string;
  country: string;
}

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    orderNumber: text('order_number'),
    customerId: uuid('customer_id').references(() => customers.id),
    paymentMode: paymentModeEnum('payment_mode').notNull(),
    financialStatus: text('financial_status'),
    status: orderStatusEnum('status').notNull().default('open'),
    totalPaise: integer('total_paise').notNull(),
    currency: text('currency').notNull().default('INR'),
    shippingAddress: jsonb('shipping_address').$type<ShippingAddress>(),
    shippingPincode: text('shipping_pincode'),
    riskScore: integer('risk_score'),
    riskAction: riskActionEnum('risk_action'),
    riskReasons: jsonb('risk_reasons').$type<string[]>(),
    placedAt: timestamp('placed_at', { withTimezone: true }).notNull(),
    /** Platform's updated_at — used to ignore out-of-order webhooks. */
    sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('orders_store_external_uq').on(t.storeId, t.externalId),
    index('orders_store_placed_idx').on(t.storeId, t.placedAt),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    storeId: uuid('store_id').notNull(),
    variantId: text('variant_id'),
    sku: text('sku'),
    title: text('title').notNull(),
    quantity: integer('quantity').notNull(),
    unitPricePaise: integer('unit_price_paise').notNull(),
  },
  (t) => [index('order_items_order_idx').on(t.orderId), index('order_items_store_variant_idx').on(t.storeId, t.variantId)],
);

// ---------- abandoned checkouts (ReRoute buyer pool) ----------
export interface CheckoutLine {
  variantId: string | null;
  sku: string | null;
  title: string;
  quantity: number;
  unitPricePaise: number;
}

export const checkouts = pgTable(
  'checkouts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    customerPhoneE164: text('customer_phone_e164'),
    customerName: text('customer_name'),
    whatsappConsent: boolean('whatsapp_consent').notNull().default(false),
    pincode: text('pincode'),
    shippingAddress: jsonb('shipping_address').$type<ShippingAddress>(),
    lines: jsonb('lines').$type<CheckoutLine[]>().notNull(),
    totalPaise: integer('total_paise').notNull(),
    recoveryUrl: text('recovery_url'),
    status: checkoutStatusEnum('status').notNull().default('abandoned'),
    abandonedAt: timestamp('abandoned_at', { withTimezone: true }).notNull(),
    lastNudgedAt: timestamp('last_nudged_at', { withTimezone: true }),
    nudgeCount: integer('nudge_count').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('checkouts_store_external_uq').on(t.storeId, t.externalId),
    index('checkouts_store_status_abandoned_idx').on(t.storeId, t.status, t.abandonedAt),
    index('checkouts_lines_gin').using('gin', t.lines),
  ],
);

// ---------- shipments ----------
export const shipments = pgTable(
  'shipments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    courier: text('courier').notNull(),
    awb: text('awb').notNull(),
    status: shipmentStatusEnum('status').notNull().default('created'),
    ndrCount: integer('ndr_count').notNull().default(0),
    lastNdrReason: text('last_ndr_reason'),
    destinationPincode: text('destination_pincode'),
    lastEventAt: timestamp('last_event_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('shipments_courier_awb_uq').on(t.courier, t.awb),
    index('shipments_store_status_idx').on(t.storeId, t.status),
  ],
);

export const trackingEvents = pgTable(
  'tracking_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shipmentId: uuid('shipment_id')
      .notNull()
      .references(() => shipments.id, { onDelete: 'cascade' }),
    status: shipmentStatusEnum('status').notNull(),
    rawStatus: text('raw_status').notNull(),
    reason: text('reason'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    dedupeKey: text('dedupe_key').notNull(),
  },
  (t) => [uniqueIndex('tracking_events_dedupe_uq').on(t.dedupeKey)],
);

// ---------- COD -> prepaid ----------
export const prepaidConversions = pgTable(
  'prepaid_conversions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    riskScore: integer('risk_score').notNull(),
    discountPaise: integer('discount_paise').notNull(),
    amountPaise: integer('amount_paise').notNull(),
    paymentLinkId: text('payment_link_id'),
    paymentLinkUrl: text('payment_link_url'),
    status: conversionStatusEnum('status').notNull().default('sent'),
    razorpayPaymentId: text('razorpay_payment_id'),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('prepaid_conversions_order_uq').on(t.orderId),
    uniqueIndex('prepaid_conversions_link_uq').on(t.paymentLinkId),
  ],
);

// ---------- ReRoute ----------
export const rerouteCases = pgTable(
  'reroute_cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    shipmentId: uuid('shipment_id')
      .notNull()
      .references(() => shipments.id),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    status: rerouteCaseStatusEnum('status').notNull().default('evaluating'),
    reason: text('reason'),
    offerPricePaise: integer('offer_price_paise'),
    deadlineAt: timestamp('deadline_at', { withTimezone: true }),
    winningOfferId: uuid('winning_offer_id'),
    newOrderExternalId: text('new_order_external_id'),
    savedPaise: integer('saved_paise'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('reroute_cases_shipment_uq').on(t.shipmentId),
    index('reroute_cases_store_status_idx').on(t.storeId, t.status),
  ],
);

export const rerouteOffers = pgTable(
  'reroute_offers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => rerouteCases.id, { onDelete: 'cascade' }),
    storeId: uuid('store_id').notNull(),
    checkoutId: uuid('checkout_id').references(() => checkouts.id),
    phoneE164: text('phone_e164').notNull(),
    distanceKm: doublePrecision('distance_km').notNull(),
    score: doublePrecision('score').notNull(),
    pricePaise: integer('price_paise').notNull(),
    paymentLinkId: text('payment_link_id'),
    paymentLinkUrl: text('payment_link_url'),
    status: rerouteOfferStatusEnum('status').notNull().default('sent'),
    razorpayPaymentId: text('razorpay_payment_id'),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('reroute_offers_link_uq').on(t.paymentLinkId),
    index('reroute_offers_case_idx').on(t.caseId),
  ],
);

// ---------- infra ----------
/** Idempotency ledger: one row per processed webhook delivery. */
export const webhookReceipts = pgTable('webhook_receipts', {
  id: text('id').primaryKey(),
  source: text('source').notNull(),
  topic: text('topic').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id'),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    data: jsonb('data').$type<Record<string, unknown>>(),
    at: timestamp('at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [index('audit_log_store_at_idx').on(t.storeId, t.at)],
);

export type Store = typeof stores.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type Checkout = typeof checkouts.$inferSelect;
export type Shipment = typeof shipments.$inferSelect;
export type RerouteCase = typeof rerouteCases.$inferSelect;
export type RerouteOffer = typeof rerouteOffers.$inferSelect;
export type Customer = typeof customers.$inferSelect;
