/** Typed client for the ReRoute seller API (/auth, /app-api). Cookies carry the session. */

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

type Json = Record<string, unknown> | unknown[];

async function request<T>(method: string, path: string, body?: Json): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'content-type': 'application/json', accept: 'application/json' } : { accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Can’t reach ReRoute. Check your connection and try again.', 0);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) {
    if (res.status === 401 && path.startsWith('/app-api/')) window.dispatchEvent(new Event('rr:unauthorized'));
    throw new ApiError(data.error ?? data.message ?? `Request failed (${res.status})`, res.status);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: Json = {}) => request<T>('POST', path, body),
  patch: <T>(path: string, body: Json) => request<T>('PATCH', path, body),
};

// ---------- types (mirror the backend responses) ----------
export type Role = 'owner' | 'admin' | 'viewer';
export interface User { id: string; email: string; name: string }
export interface StoreSummary { id: string; name: string | null; platform: string; shopDomain: string; status: string; role: Role }
export interface Integrations { shopify: boolean; razorpay: boolean; whatsapp: boolean; shiprocket: boolean }
export interface Me { user: User; stores: StoreSummary[]; integrations?: Integrations }

export interface StoreSettings {
  codPrepaidEnabled: boolean;
  nudgeThreshold: number;
  verifyThreshold: number;
  prepaidDiscountPaise: number;
  rerouteEnabled: boolean;
  rerouteDiscountBps: number;
  rerouteMinOrderPaise: number;
  rerouteExcludedSkus: string[];
}
export interface StoreDetail { id: string; name: string | null; platform: string; shopDomain: string; status: string; settings: StoreSettings; installedAt: string }

export type CaseStatus = 'evaluating' | 'ineligible' | 'no_match' | 'offered' | 'claimed' | 'completed' | 'expired' | 'failed';
export type RiskAction = 'allow' | 'nudge_prepaid' | 'partial_cod' | 'verify' | 'block_cod';

export interface Overview {
  rescued: { parcels: number; paise: number; monthParcels: number; monthPaise: number; liveOffers: number };
  prepaid: { sent: number; paid: number; paidPaise: number; rate: number };
  orders30d: { total: number; cod: number; codShare: number; gmvPaise: number; rtoRate: number };
  daily: Array<{ day: string; paise: number; parcels: number }>;
  needsAction: {
    ndr: Array<{ shipmentId: string; awb: string; reason: string | null; at: string | null; orderNumber: string | null; pincode: string | null; totalPaise: number; caseStatus: CaseStatus | null }>;
    risky: Array<{ orderId: string; orderNumber: string | null; riskScore: number | null; riskAction: RiskAction | null; totalPaise: number; pincode: string | null; at: string }>;
  };
}

export interface OrderRow {
  id: string;
  orderNumber: string | null;
  paymentMode: 'cod' | 'prepaid' | 'partial_cod';
  status: string;
  totalPaise: number;
  pincode: string | null;
  city: string | null;
  customer: string;
  riskScore: number | null;
  riskAction: RiskAction | null;
  riskReasons: string[] | null;
  prepaidOffer: 'sent' | 'paid' | 'expired' | 'failed' | null;
  placedAt: string;
}

export interface CaseRow {
  id: string;
  status: CaseStatus;
  reason: string | null;
  offerPricePaise: number | null;
  savedPaise: number | null;
  deadlineAt: string | null;
  createdAt: string;
  updatedAt: string;
  orderNumber: string | null;
  orderTotalPaise: number;
  fromPincode: string | null;
  awb: string;
  courier: string;
  offersSent: number;
  winnerKm: number | null;
}

export interface Page<T> { total: number; items: T[] }
