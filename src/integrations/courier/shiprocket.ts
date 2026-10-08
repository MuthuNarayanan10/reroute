import { env, integrations } from '../../config/env.js';
import { safeEqual } from '../../lib/crypto.js';
import { fetchJson } from '../../lib/http.js';
import type { ShippingAddress } from '../../db/schema.js';
import { normalizeStatus } from './status-map.js';
import type { AddressUpdateResult, CourierAdapter, CourierEvent } from './types.js';

const BASE = 'https://apiv2.shiprocket.in/v1/external';

interface ShiprocketWebhook {
  awb?: string | number;
  order_id?: string | number;
  current_status?: string;
  shipment_status?: string;
  current_timestamp?: string;
  scans?: Array<{ date?: string; activity?: string; status?: string; location?: string }>;
  ndr_reason?: string;
}

let token: { value: string; expiresAt: number } | undefined;

async function authToken(): Promise<string> {
  if (token && token.expiresAt > Date.now()) return token.value;
  const e = env();
  const res = await fetchJson<{ token: string }>(`${BASE}/auth/login`, {
    op: 'shiprocket.auth',
    method: 'POST',
    body: { email: e.SHIPROCKET_EMAIL, password: e.SHIPROCKET_PASSWORD },
    retries: 2,
  });
  // Tokens are long-lived; refresh daily to be safe.
  token = { value: res.token, expiresAt: Date.now() + 24 * 3600 * 1000 };
  return res.token;
}

export const shiprocketAdapter: CourierAdapter = {
  name: 'shiprocket',

  verifyWebhook(headers) {
    // Configure the same secret as the "token" in Shiprocket's webhook settings; it is sent as x-api-key.
    const h = headers['x-api-key'];
    const value = Array.isArray(h) ? h[0] : h;
    const secret = env().COURIER_WEBHOOK_SECRET;
    return !!value && !!secret && safeEqual(value, secret);
  },

  parseWebhook(payload): CourierEvent[] {
    const p = payload as ShiprocketWebhook;
    if (!p.awb) return [];
    const rawStatus = p.current_status ?? p.shipment_status ?? 'unknown';
    const occurredAt = p.current_timestamp ? new Date(p.current_timestamp.replace(' ', 'T') + '+05:30') : new Date();
    const lastScan = p.scans?.at(-1);
    const awb = String(p.awb);
    return [
      {
        awb,
        orderRef: p.order_id != null ? String(p.order_id) : null,
        status: normalizeStatus(rawStatus),
        rawStatus,
        reason: p.ndr_reason ?? lastScan?.activity ?? null,
        occurredAt: Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
        dedupeKey: `shiprocket:${awb}:${rawStatus}:${p.current_timestamp ?? ''}`,
      },
    ];
  },

  async updateConsignee(awb: string, address: ShippingAddress): Promise<AddressUpdateResult> {
    // Uses the NDR re-attempt action with updated consignee details.
    // IMPORTANT: confirm the exact endpoint + fields with your Shiprocket account manager; consignee
    // changes on NDR shipments are typically enabled per account under a commercial agreement.
    if (!integrations().shiprocket) return { ok: false, reason: 'Shiprocket is not configured on this server' };
    const t = await authToken();
    try {
      await fetchJson(`${BASE}/ndr/${encodeURIComponent(awb)}/action`, {
        op: 'shiprocket.ndr.action',
        method: 'POST',
        headers: { authorization: `Bearer ${t}` },
        retries: 1,
        body: {
          action: 're-attempt',
          comments: 'ReRoute: consignee updated to verified prepaid buyer in same delivery zone',
          consignee_name: address.name,
          phone: address.phoneE164?.replace('+91', ''),
          address1: address.address1,
          address2: address.address2 ?? '',
          pincode: address.pincode,
          city: address.city,
          state: address.state,
        },
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  },
};
