import type { StoreSettings } from '../../db/schema.js';

export interface RiskFeatures {
  orderValuePaise: number;
  customer: { ordersCount: number; deliveredCount: number; rtoCount: number } | null;
  pincode: { delivered: number; rto: number } | null;
  hasValidPhone: boolean;
  address1: string | null;
  /** Largest quantity of a single SKU in the order. */
  maxLineQuantity: number;
  /** Hour of day in IST, 0-23. */
  placedHourIst: number;
}

export type RiskAction = 'allow' | 'nudge_prepaid' | 'partial_cod' | 'verify' | 'block_cod';

export interface RiskResult {
  score: number;
  action: RiskAction;
  reasons: string[];
}

/** Industry prior for COD RTO in India (~25%); used to smooth sparse pincode data. */
const PINCODE_PRIOR_RTO = 0.25;
const PINCODE_PRIOR_WEIGHT = 10;

/**
 * Explainable rules-based COD risk score (0-100).
 * Deliberately transparent so sellers trust it; swap for an ML model once you have
 * enough labelled delivered/RTO outcomes (the same features feed it).
 */
export function scoreCodRisk(f: RiskFeatures, settings: Pick<StoreSettings, 'nudgeThreshold' | 'verifyThreshold'>): RiskResult {
  let score = 20;
  const reasons: string[] = [];
  const add = (points: number, reason: string) => {
    score += points;
    if (points !== 0) reasons.push(`${points > 0 ? '+' : ''}${points} ${reason}`);
  };

  // Customer history
  if (!f.customer || f.customer.ordersCount <= 1) {
    add(15, 'first-time customer');
  } else {
    const outcomes = f.customer.deliveredCount + f.customer.rtoCount;
    if (outcomes > 0) {
      const rtoRate = f.customer.rtoCount / outcomes;
      add(Math.round(rtoRate * 50), `customer RTO rate ${(rtoRate * 100).toFixed(0)}%`);
    }
    if (f.customer.deliveredCount >= 2 && f.customer.rtoCount === 0) add(-15, 'trusted repeat customer');
  }

  // Pincode history (Bayesian-smoothed)
  const pDelivered = f.pincode?.delivered ?? 0;
  const pRto = f.pincode?.rto ?? 0;
  const pinRate = (pRto + PINCODE_PRIOR_RTO * PINCODE_PRIOR_WEIGHT) / (pDelivered + pRto + PINCODE_PRIOR_WEIGHT);
  add(clamp(Math.round((pinRate - 0.2) * 100), -10, 30), `pincode RTO rate ${(pinRate * 100).toFixed(0)}%`);

  // Order value
  if (f.orderValuePaise > 6_000_00) add(25, 'very high COD value');
  else if (f.orderValuePaise > 3_000_00) add(10, 'high COD value');
  else if (f.orderValuePaise < 300_00) add(-5, 'low order value');

  // Contact + address quality
  if (!f.hasValidPhone) add(25, 'invalid phone number');
  const addr = (f.address1 ?? '').trim();
  if (addr.length < 15) add(10, 'short/incomplete address');
  if (addr && !/\d/.test(addr)) add(5, 'address has no house/flat number');

  // Behaviour
  if (f.maxLineQuantity > 3) add(10, 'unusually high quantity of one item');
  if (f.placedHourIst >= 0 && f.placedHourIst < 5) add(5, 'placed late at night');

  score = clamp(score, 0, 100);

  let action: RiskAction = 'allow';
  if (f.customer && f.customer.rtoCount >= 3 && f.customer.deliveredCount === 0) action = 'block_cod';
  else if (!f.hasValidPhone) action = 'verify';
  else if (score >= settings.verifyThreshold) action = 'partial_cod';
  else if (score >= settings.nudgeThreshold) action = 'nudge_prepaid';

  return { score, action, reasons };
}

export function istHour(d: Date): number {
  const minutes = (d.getUTCHours() * 60 + d.getUTCMinutes() + 330) % 1440;
  return Math.floor(minutes / 60);
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
