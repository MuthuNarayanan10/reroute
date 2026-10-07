import { and, eq } from 'drizzle-orm';
import { env } from '../../config/env.js';
import { db } from '../../db/client.js';
import { defaultStoreSettings, stores, type Store, type StoreSettings } from '../../db/schema.js';
import { decrypt, encrypt } from '../../lib/crypto.js';
import { ShopifyClient } from '../../integrations/shopify/client.js';

export async function upsertShopifyStore(input: { shop: string; accessToken: string; scopes: string; name?: string }) {
  const accessTokenEnc = encrypt(input.accessToken, env().ENCRYPTION_KEY);
  const [row] = await db
    .insert(stores)
    .values({
      platform: 'shopify',
      shopDomain: input.shop,
      name: input.name ?? null,
      accessTokenEnc,
      scopes: input.scopes,
      status: 'active',
      settings: defaultStoreSettings,
    })
    .onConflictDoUpdate({
      target: [stores.platform, stores.shopDomain],
      set: {
        accessTokenEnc,
        scopes: input.scopes,
        status: 'active',
        uninstalledAt: null,
        installedAt: new Date(),
        ...(input.name ? { name: input.name } : {}),
      },
    })
    .returning();
  if (!row) throw new Error('store upsert failed');
  return row;
}

export async function getStore(id: string): Promise<Store | undefined> {
  const [row] = await db.select().from(stores).where(eq(stores.id, id)).limit(1);
  return row;
}

export async function getActiveShopifyStoreByDomain(shop: string): Promise<Store | undefined> {
  const [row] = await db
    .select()
    .from(stores)
    .where(and(eq(stores.platform, 'shopify'), eq(stores.shopDomain, shop)))
    .limit(1);
  return row;
}

export async function markUninstalled(storeId: string) {
  await db
    .update(stores)
    .set({ status: 'uninstalled', uninstalledAt: new Date(), accessTokenEnc: null })
    .where(eq(stores.id, storeId));
}

export async function updateSettings(storeId: string, patch: Partial<StoreSettings>): Promise<StoreSettings> {
  const store = await getStore(storeId);
  if (!store) throw new Error('store not found');
  const settings = { ...defaultStoreSettings, ...store.settings, ...patch };
  await db.update(stores).set({ settings }).where(eq(stores.id, storeId));
  return settings;
}

export function settingsOf(store: Store): StoreSettings {
  return { ...defaultStoreSettings, ...store.settings };
}

export function shopifyClientFor(store: Store): ShopifyClient {
  if (store.platform !== 'shopify') throw new Error(`store ${store.id} is not a Shopify store`);
  if (!store.accessTokenEnc || store.status !== 'active') throw new Error(`store ${store.id} has no active token`);
  return new ShopifyClient(store.shopDomain, decrypt(store.accessTokenEnc, env().ENCRYPTION_KEY));
}
