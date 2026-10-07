import { env } from '../../config/env.js';
import { hmacSha256, safeEqual } from '../../lib/crypto.js';
import { fetchJson } from '../../lib/http.js';

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

export function isValidShopDomain(shop: string | undefined): shop is string {
  return !!shop && SHOP_RE.test(shop);
}

export function buildInstallUrl(shop: string, state: string): string {
  const e = env();
  const params = new URLSearchParams({
    client_id: e.SHOPIFY_API_KEY,
    scope: e.SHOPIFY_SCOPES,
    redirect_uri: `${e.APP_URL}/auth/shopify/callback`,
    state,
  });
  return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
}

/**
 * Verifies the HMAC Shopify adds to OAuth redirects / app loads.
 * Message = all query params except `hmac` (and legacy `signature`), sorted, joined with '&'.
 */
export function verifyOAuthHmac(query: Record<string, string | undefined>, secret: string): boolean {
  const { hmac, signature: _signature, ...rest } = query;
  if (!hmac) return false;
  const message = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k] ?? ''}`)
    .join('&');
  return safeEqual(hmacSha256(secret, message, 'hex'), hmac);
}

export async function exchangeCodeForToken(shop: string, code: string): Promise<{ accessToken: string; scope: string }> {
  const e = env();
  const res = await fetchJson<{ access_token: string; scope: string }>(`https://${shop}/admin/oauth/access_token`, {
    op: 'shopify.oauth.token',
    method: 'POST',
    body: { client_id: e.SHOPIFY_API_KEY, client_secret: e.SHOPIFY_API_SECRET, code },
    retries: 1,
  });
  return { accessToken: res.access_token, scope: res.scope };
}
