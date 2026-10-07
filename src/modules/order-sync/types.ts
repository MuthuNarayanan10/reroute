import type { CheckoutLine, ShippingAddress } from '../../db/schema.js';

/** Platform-agnostic order shape. Every connector (Shopify, WooCommerce, custom) maps into this. */
export interface NormalizedOrder {
  externalId: string;
  orderNumber: string | null;
  paymentMode: 'cod' | 'prepaid' | 'partial_cod';
  financialStatus: string | null;
  cancelled: boolean;
  totalPaise: number;
  currency: string;
  customer: {
    externalId: string | null;
    name: string | null;
    email: string | null;
    phoneE164: string | null;
    whatsappConsent: boolean;
  };
  shippingAddress: ShippingAddress | null;
  items: Array<{
    variantId: string | null;
    sku: string | null;
    title: string;
    quantity: number;
    unitPricePaise: number;
  }>;
  placedAt: Date;
  sourceUpdatedAt: Date;
}

export interface NormalizedCheckout {
  externalId: string;
  customerPhoneE164: string | null;
  customerName: string | null;
  whatsappConsent: boolean;
  pincode: string | null;
  shippingAddress: ShippingAddress | null;
  lines: CheckoutLine[];
  totalPaise: number;
  recoveryUrl: string | null;
  abandonedAt: Date;
  completed: boolean;
}
