import { distanceKm, type LatLng } from '../../lib/geo.js';

export interface ParcelLine {
  variantId: string | null;
  sku: string | null;
  quantity: number;
}

export interface Candidate {
  checkoutId: string;
  phoneE164: string | null;
  whatsappConsent: boolean;
  location: LatLng | null;
  abandonedAt: Date;
  totalPaise: number;
  lines: Array<{ variantId: string | null; sku: string | null; quantity: number }>;
}

export interface RankedCandidate {
  checkoutId: string;
  phoneE164: string;
  distanceKm: number;
  score: number;
}

export interface MatchInput {
  parcel: { lines: ParcelLine[]; location: LatLng; valuePaise: number; originalPhoneE164: string | null };
  candidates: Candidate[];
  radiusKm: number;
  now: Date;
  maxCandidates: number;
  maxAgeHours?: number;
}

const RECENCY_HALF_LIFE_H = 72;

/**
 * Finds nearby shoppers whose abandoned cart contains everything in the failed parcel.
 * Score (0-1) = 50% proximity + 30% recency + 20% price fit.
 */
export function rankCandidates(input: MatchInput): RankedCandidate[] {
  const maxAgeMs = (input.maxAgeHours ?? 14 * 24) * 3600 * 1000;
  const best = new Map<string, RankedCandidate>();

  for (const c of input.candidates) {
    if (!c.phoneE164 || !c.whatsappConsent || !c.location) continue;
    if (c.phoneE164 === input.parcel.originalPhoneE164) continue;
    const ageMs = input.now.getTime() - c.abandonedAt.getTime();
    if (ageMs < 0 || ageMs > maxAgeMs) continue;
    if (!cartCoversParcel(c.lines, input.parcel.lines)) continue;

    const d = distanceKm(input.parcel.location, c.location);
    if (d > input.radiusKm) continue;

    const proximity = 1 - d / input.radiusKm;
    const recency = Math.pow(0.5, ageMs / 3600_000 / RECENCY_HALF_LIFE_H);
    const priceFit = c.totalPaise > 0 ? Math.min(1, input.parcel.valuePaise / c.totalPaise) : 0;
    const score = round(0.5 * proximity + 0.3 * recency + 0.2 * priceFit);

    const prev = best.get(c.phoneE164);
    if (!prev || prev.score < score) {
      best.set(c.phoneE164, { checkoutId: c.checkoutId, phoneE164: c.phoneE164, distanceKm: round(d), score });
    }
  }

  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, input.maxCandidates);
}

export function cartCoversParcel(cart: Candidate['lines'], parcel: ParcelLine[]): boolean {
  return parcel.every((p) =>
    cart.some(
      (l) =>
        ((p.variantId && l.variantId === p.variantId) || (p.sku && l.sku && l.sku.toLowerCase() === p.sku.toLowerCase())) &&
        l.quantity >= p.quantity,
    ),
  );
}

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}
