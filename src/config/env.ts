import { z } from 'zod';

const csv = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  LOG_LEVEL: z.string().default('info'),
  APP_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i, 'ENCRYPTION_KEY must be 64 hex chars'),
  ADMIN_API_KEYS: csv,

  SHOPIFY_API_KEY: z.string().min(1),
  SHOPIFY_API_SECRET: z.string().min(1),
  SHOPIFY_SCOPES: z.string().default('read_orders,write_orders,read_products,read_customers,read_checkouts'),
  SHOPIFY_API_VERSION: z.string().default('2026-07'),

  RAZORPAY_KEY_ID: z.string().min(1),
  RAZORPAY_KEY_SECRET: z.string().min(1),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1),

  WHATSAPP_TOKEN: z.string().min(1),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
  WHATSAPP_TEMPLATE_PREPAID: z.string().default('cod_to_prepaid_offer'),
  WHATSAPP_TEMPLATE_REROUTE: z.string().default('nearby_parcel_offer'),
  WHATSAPP_TEMPLATE_CART: z.string().default('abandoned_cart_reminder'),

  SHIPROCKET_EMAIL: z.string().default(''),
  SHIPROCKET_PASSWORD: z.string().default(''),
  COURIER_WEBHOOK_SECRET: z.string().min(1),

  REROUTE_RADIUS_KM: z.coerce.number().positive().default(10),
  REROUTE_DISCOUNT_BPS: z.coerce.number().int().min(0).max(5000).default(1000),
  REROUTE_OFFER_TTL_MINUTES: z.coerce.number().int().positive().default(240),
  REROUTE_MAX_CANDIDATES: z.coerce.number().int().positive().default(5),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Validated environment. Fails fast at boot if anything required is missing. */
export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new Error(`Invalid environment: ${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}
