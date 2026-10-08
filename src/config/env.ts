import { existsSync } from 'node:fs';
import { z } from 'zod';

// Local development: load .env automatically (hosting platforms inject real env vars; those always win).
if (process.env.NODE_ENV !== 'test' && existsSync('.env')) {
  try {
    process.loadEnvFile('.env');
  } catch {
    /* malformed .env: validation below reports what is missing */
  }
}

const csv = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

/** Accepts "https://x.com", "x.com" (as Render's hostname reference gives) — always returns an origin-style URL. */
const appUrl = z
  .string()
  .min(1, 'APP_URL is required (your public site address, e.g. https://reroute.in)')
  .transform((v) => (/^https?:\/\//.test(v) ? v : `https://${v}`).replace(/\/+$/, ''))
  .pipe(z.string().url());

/** 32-byte key as 64 hex chars, or base64 (what hosting "generate value" buttons produce). Normalised to hex. */
const encryptionKey = z.string().transform((v, ctx) => {
  if (/^[0-9a-f]{64}$/i.test(v)) return v.toLowerCase();
  const b = Buffer.from(v, 'base64');
  if (b.length === 32) return b.toString('hex');
  ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64)' });
  return z.NEVER;
});

/** Integration credentials are optional at boot so the site can go live first; each integration refuses to run without its own. */
const optional = z.string().default('');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  LOG_LEVEL: z.string().default('info'),
  APP_URL: appUrl,
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  ENCRYPTION_KEY: encryptionKey,
  ADMIN_API_KEYS: csv,
  /** Extra origins allowed to call /auth and /app-api (e.g. the Vite dev server). APP_URL is always allowed. */
  ALLOWED_ORIGINS: csv,
  /** Folder with the built website + dashboard (npm run build:web). */
  WEB_DIST: z.string().default('web/dist'),

  SHOPIFY_API_KEY: optional,
  SHOPIFY_API_SECRET: optional,
  SHOPIFY_SCOPES: z.string().default('read_orders,write_orders,read_products,read_customers,read_checkouts'),
  SHOPIFY_API_VERSION: z.string().default('2026-07'),

  RAZORPAY_KEY_ID: optional,
  RAZORPAY_KEY_SECRET: optional,
  RAZORPAY_WEBHOOK_SECRET: optional,

  WHATSAPP_TOKEN: optional,
  WHATSAPP_PHONE_NUMBER_ID: optional,
  WHATSAPP_TEMPLATE_PREPAID: z.string().default('cod_to_prepaid_offer'),
  WHATSAPP_TEMPLATE_REROUTE: z.string().default('nearby_parcel_offer'),
  WHATSAPP_TEMPLATE_CART: z.string().default('abandoned_cart_reminder'),

  SHIPROCKET_EMAIL: optional,
  SHIPROCKET_PASSWORD: optional,
  COURIER_WEBHOOK_SECRET: optional,

  REROUTE_RADIUS_KM: z.coerce.number().positive().default(10),
  REROUTE_DISCOUNT_BPS: z.coerce.number().int().min(0).max(5000).default(1000),
  REROUTE_OFFER_TTL_MINUTES: z.coerce.number().int().positive().default(240),
  REROUTE_MAX_CANDIDATES: z.coerce.number().int().positive().default(5),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Validated environment. Fails fast at boot if anything required is missing. */
export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  return parsed.data;
}

export class NotConfiguredError extends Error {
  readonly statusCode = 503;
  constructor(what: string, vars: string[]) {
    super(`${what} is not configured on this server yet (set ${vars.join(', ')}).`);
  }
}

/** Which integrations have credentials. Used by /ready and the dashboard. */
export function integrations() {
  const e = env();
  return {
    shopify: !!(e.SHOPIFY_API_KEY && e.SHOPIFY_API_SECRET),
    razorpay: !!(e.RAZORPAY_KEY_ID && e.RAZORPAY_KEY_SECRET && e.RAZORPAY_WEBHOOK_SECRET),
    whatsapp: !!(e.WHATSAPP_TOKEN && e.WHATSAPP_PHONE_NUMBER_ID),
    shiprocket: !!(e.SHIPROCKET_EMAIL && e.SHIPROCKET_PASSWORD && e.COURIER_WEBHOOK_SECRET),
  };
}

export function requireConfigured(name: keyof ReturnType<typeof integrations>) {
  if (integrations()[name]) return;
  const vars = {
    shopify: ['SHOPIFY_API_KEY', 'SHOPIFY_API_SECRET'],
    razorpay: ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'],
    whatsapp: ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'],
    shiprocket: ['SHIPROCKET_EMAIL', 'SHIPROCKET_PASSWORD', 'COURIER_WEBHOOK_SECRET'],
  }[name];
  throw new NotConfiguredError(name[0]!.toUpperCase() + name.slice(1), vars);
}
