import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { checkouts, customers, orders, stores } from '../../db/schema.js';
import { audit } from '../../lib/audit.js';
import { toE164India } from '../../lib/phone.js';

/**
 * Right-to-erasure (Shopify customers/redact + India DPDP Act).
 * We anonymise rather than delete orders, so financial records stay intact.
 */
export async function redactCustomer(storeId: string, input: { phone?: string | null; email?: string | null }) {
  const phone = toE164India(input.phone);
  await db.transaction(async (tx) => {
    const matches = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.storeId, storeId), phone ? eq(customers.phoneE164, phone) : eq(customers.email, input.email ?? '__none__')));
    for (const c of matches) {
      await tx
        .update(customers)
        .set({ phoneE164: null, email: null, name: null, whatsappConsent: false })
        .where(eq(customers.id, c.id));
      await tx.update(orders).set({ shippingAddress: null }).where(eq(orders.customerId, c.id));
    }
    if (phone) {
      await tx
        .update(checkouts)
        .set({ customerPhoneE164: null, customerName: null, shippingAddress: null, whatsappConsent: false })
        .where(and(eq(checkouts.storeId, storeId), eq(checkouts.customerPhoneE164, phone)));
    }
    await audit({ storeId, actor: 'privacy', action: 'customer_redacted', entity: 'customer', data: { count: matches.length } }, tx);
  });
}

/** Shopify shop/redact (48h after uninstall): remove everything for the store. */
export async function redactStore(storeId: string) {
  await db.delete(stores).where(eq(stores.id, storeId)); // cascades to store-scoped tables
  await audit({ storeId, actor: 'privacy', action: 'store_redacted', entity: 'store', entityId: storeId });
}
