import type { ShippingAddress } from '../../db/schema.js';

export type NormalizedShipmentStatus =
  | 'created'
  | 'in_transit'
  | 'out_for_delivery'
  | 'ndr'
  | 'rto_initiated'
  | 'rto_delivered'
  | 'delivered';

export interface CourierEvent {
  awb: string;
  /** Our order reference if the courier echoes it back (channel order id). */
  orderRef: string | null;
  status: NormalizedShipmentStatus;
  rawStatus: string;
  reason: string | null;
  occurredAt: Date;
  /** Stable id for dedupe: same event delivered twice must produce the same key. */
  dedupeKey: string;
}

export interface AddressUpdateResult {
  ok: boolean;
  reference?: string;
  reason?: string;
}

/**
 * Every courier/aggregator implements this. Adding Delhivery, Xpressbees, Ekart...
 * means adding one adapter file — the ReRoute engine never changes.
 */
export interface CourierAdapter {
  readonly name: string;
  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): boolean;
  parseWebhook(payload: unknown): CourierEvent[];
  /**
   * Redirect an in-transit / NDR shipment to a new consignee in the same delivery zone.
   * This needs a commercial agreement with the courier — see docs/COURIER_PARTNERSHIP.md.
   */
  updateConsignee(awb: string, address: ShippingAddress): Promise<AddressUpdateResult>;
}
