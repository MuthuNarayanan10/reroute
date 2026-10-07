import { hmacSha256, safeEqual } from '../../lib/crypto.js';

/** Shopify signs the raw request body with the app secret, base64-encoded. */
export function verifyShopifyWebhook(rawBody: Buffer | string, hmacHeader: string | undefined, secret: string): boolean {
  if (!hmacHeader) return false;
  return safeEqual(hmacSha256(secret, rawBody, 'base64'), hmacHeader);
}

/** Topics we subscribe to on install. */
export const SHOPIFY_WEBHOOK_TOPICS = [
  'ORDERS_CREATE',
  'ORDERS_UPDATED',
  'ORDERS_CANCELLED',
  'CHECKOUTS_CREATE',
  'CHECKOUTS_UPDATE',
  'APP_UNINSTALLED',
] as const;

/** GraphQL enum (ORDERS_CREATE) -> REST topic header (orders/create). */
export function topicHeaderFromEnum(t: string): string {
  const parts = t.toLowerCase().split('_');
  return `${parts[0]}/${parts.slice(1).join('_')}`;
}
