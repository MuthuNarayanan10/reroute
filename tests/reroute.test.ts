import { describe, expect, it } from 'vitest';
import { cartCoversParcel, rankCandidates, type Candidate } from '../src/modules/reroute/matcher.js';
import { checkEligibility, type EligibilityInput } from '../src/modules/reroute/eligibility.js';

const now = new Date('2026-10-08T12:00:00Z');
const annaNagar = { lat: 13.085, lng: 80.2101 };
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);

const parcel = {
  lines: [{ variantId: '111', sku: 'MUSLIN-BLUE', quantity: 1 }],
  location: annaNagar,
  valuePaise: 129900,
  originalPhoneE164: '+919876543210',
};

function cand(over: Partial<Candidate>): Candidate {
  return {
    checkoutId: 'c1',
    phoneE164: '+919000000001',
    whatsappConsent: true,
    location: { lat: 13.09, lng: 80.22 },
    abandonedAt: hoursAgo(5),
    totalPaise: 129900,
    lines: [{ variantId: '111', sku: 'MUSLIN-BLUE', quantity: 1 }],
    ...over,
  };
}

describe('ReRoute matcher', () => {
  it('finds a nearby shopper whose cart contains the parcel', () => {
    const r = rankCandidates({ parcel, candidates: [cand({})], radiusKm: 10, now, maxCandidates: 5 });
    expect(r).toHaveLength(1);
    expect(r[0]!.distanceKm).toBeLessThan(2);
  });

  it('excludes: no consent, too far, wrong product, stale cart, the original buyer', () => {
    const r = rankCandidates({
      parcel,
      candidates: [
        cand({ checkoutId: 'no-consent', phoneE164: '+919000000002', whatsappConsent: false }),
        cand({ checkoutId: 'far', phoneE164: '+919000000003', location: { lat: 12.97, lng: 77.59 } }), // Bengaluru
        cand({ checkoutId: 'wrong', phoneE164: '+919000000004', lines: [{ variantId: '999', sku: 'OTHER', quantity: 1 }] }),
        cand({ checkoutId: 'stale', phoneE164: '+919000000005', abandonedAt: hoursAgo(24 * 20) }),
        cand({ checkoutId: 'original', phoneE164: '+919876543210' }),
      ],
      radiusKm: 10,
      now,
      maxCandidates: 5,
    });
    expect(r).toHaveLength(0);
  });

  it('ranks closer and fresher carts higher, and de-duplicates by phone', () => {
    const r = rankCandidates({
      parcel,
      candidates: [
        cand({ checkoutId: 'far-old', phoneE164: '+919000000010', location: { lat: 13.14, lng: 80.25 }, abandonedAt: hoursAgo(200) }),
        cand({ checkoutId: 'near-new', phoneE164: '+919000000011', location: { lat: 13.086, lng: 80.211 }, abandonedAt: hoursAgo(1) }),
        cand({ checkoutId: 'dup-worse', phoneE164: '+919000000011', location: { lat: 13.12, lng: 80.24 }, abandonedAt: hoursAgo(100) }),
      ],
      radiusKm: 10,
      now,
      maxCandidates: 5,
    });
    expect(r.map((x) => x.checkoutId)).toEqual(['near-new', 'far-old']);
  });

  it('respects maxCandidates', () => {
    const many = Array.from({ length: 10 }, (_, i) => cand({ checkoutId: `c${i}`, phoneE164: `+91900000010${i}` }));
    expect(rankCandidates({ parcel, candidates: many, radiusKm: 10, now, maxCandidates: 3 })).toHaveLength(3);
  });

  it('requires enough quantity and matches by SKU when variant ids differ', () => {
    expect(cartCoversParcel([{ variantId: null, sku: 'muslin-blue', quantity: 2 }], parcel.lines)).toBe(true);
    expect(cartCoversParcel([{ variantId: '111', sku: null, quantity: 1 }], [{ variantId: '111', sku: null, quantity: 2 }])).toBe(false);
  });
});

const baseElig: EligibilityInput = {
  settings: { rerouteEnabled: true, rerouteMinOrderPaise: 30000, rerouteExcludedSkus: ['PERISHABLE-1'] },
  order: { paymentMode: 'cod', status: 'fulfilled', totalPaise: 129900 },
  items: [{ sku: 'MUSLIN-BLUE', variantId: '111', quantity: 1 }],
  shipment: { status: 'ndr', ndrCount: 1, lastNdrReason: 'Customer refused delivery' },
  courierSupported: true,
};

describe('ReRoute eligibility', () => {
  it('accepts a refused COD parcel', () => {
    expect(checkEligibility(baseElig)).toEqual({ eligible: true });
  });

  it.each([
    ['prepaid order', { order: { ...baseElig.order, paymentMode: 'prepaid' as const } }],
    ['low value', { order: { ...baseElig.order, totalPaise: 10000 } }],
    ['excluded sku', { items: [{ sku: 'perishable-1', variantId: '5', quantity: 1 }] }],
    ['not ndr', { shipment: { ...baseElig.shipment, status: 'in_transit' } }],
    ['unsupported courier', { courierSupported: false }],
    ['reschedule requested', { shipment: { status: 'ndr', ndrCount: 1, lastNdrReason: 'Customer rescheduled delivery' } }],
    ['disabled', { settings: { ...baseElig.settings, rerouteEnabled: false } }],
  ])('rejects: %s', (_label, patch) => {
    const r = checkEligibility({ ...baseElig, ...patch });
    expect(r.eligible).toBe(false);
  });
});
