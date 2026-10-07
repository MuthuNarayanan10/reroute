import { logger } from '../../lib/logger.js';
import {
  mapShopifyCheckout,
  mapShopifyOrder,
  type ShopifyCheckoutPayload,
  type ShopifyOrderPayload,
} from '../../integrations/shopify/mappers.js';
import { upsertCheckout } from '../abandoned-cart/service.js';
import { redactCustomer, redactStore } from '../privacy/service.js';
import { markUninstalled } from '../stores/service.js';
import { markCancelled, upsertOrder } from './service.js';

export async function handleShopifyWebhook(storeId: string, topic: string, payload: unknown): Promise<void> {
  switch (topic) {
    case 'orders/create':
    case 'orders/updated':
      await upsertOrder(storeId, mapShopifyOrder(payload as ShopifyOrderPayload));
      return;
    case 'orders/cancelled':
      await markCancelled(storeId, String((payload as { id: string | number }).id));
      return;
    case 'checkouts/create':
    case 'checkouts/update':
      await upsertCheckout(storeId, mapShopifyCheckout(payload as ShopifyCheckoutPayload));
      return;
    case 'app/uninstalled':
      await markUninstalled(storeId);
      return;
    case 'customers/redact': {
      const p = payload as { customer?: { phone?: string | null; email?: string | null } };
      await redactCustomer(storeId, { phone: p.customer?.phone, email: p.customer?.email });
      return;
    }
    case 'shop/redact':
      await redactStore(storeId);
      return;
    case 'customers/data_request':
      // We only hold data Shopify already has; log for the compliance record.
      logger.info({ storeId }, 'customer data request received');
      return;
    default:
      logger.warn({ storeId, topic }, 'unhandled shopify topic');
  }
}
