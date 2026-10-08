import { describe, expect, it } from 'vitest';
import { createHmac, randomBytes } from 'node:crypto';
import { parseEnv } from '../src/config/env.js';
import { verifyShopifyWebhook } from '../src/integrations/shopify/webhooks.js';
import { verifyOAuthHmac } from '../src/integrations/shopify/oauth.js';
import { verifyRazorpayWebhook } from '../src/integrations/razorpay/client.js';

const minimal = { DATABASE_URL: 'postgres://x', REDIS_URL: 'redis://x', APP_URL: 'https://reroute.in', ENCRYPTION_KEY: 'a'.repeat(64) };

describe('environment', () => {
  it('boots with only the core settings (integrations can be added later)', () => {
    const e = parseEnv(minimal);
    expect(e.SHOPIFY_API_KEY).toBe('');
    expect(e.PORT).toBe(3000);
  });

  it('accepts a bare hostname for APP_URL (Render hostname reference) and strips trailing slashes', () => {
    expect(parseEnv({ ...minimal, APP_URL: 'reroute-web.onrender.com' }).APP_URL).toBe('https://reroute-web.onrender.com');
    expect(parseEnv({ ...minimal, APP_URL: 'https://reroute.in/' }).APP_URL).toBe('https://reroute.in');
  });

  it('accepts a base64 32-byte encryption key and normalises it to hex', () => {
    const key = randomBytes(32);
    expect(parseEnv({ ...minimal, ENCRYPTION_KEY: key.toString('base64') }).ENCRYPTION_KEY).toBe(key.toString('hex'));
    expect(() => parseEnv({ ...minimal, ENCRYPTION_KEY: 'too-short' })).toThrow(/ENCRYPTION_KEY/);
  });

  it('fails clearly when a core setting is missing', () => {
    expect(() => parseEnv({ ...minimal, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });
});

describe('webhooks never trust an empty secret', () => {
  const body = Buffer.from('{"id":1}');
  it('shopify', () => {
    const forged = createHmac('sha256', '').update(body).digest('base64');
    expect(verifyShopifyWebhook(body, forged, '')).toBe(false);
    const q = { shop: 'a.myshopify.com', code: 'c', state: 's' };
    const msg = Object.keys(q).sort().map((k) => `${k}=${q[k as keyof typeof q]}`).join('&');
    expect(verifyOAuthHmac({ ...q, hmac: createHmac('sha256', '').update(msg).digest('hex') }, '')).toBe(false);
  });
  it('razorpay', () => {
    expect(verifyRazorpayWebhook(body, createHmac('sha256', '').update(body).digest('hex'), '')).toBe(false);
  });
});
