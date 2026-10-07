import { describe, expect, it } from 'vitest';
import { istHour, scoreCodRisk, type RiskFeatures } from '../src/modules/cod-prepaid/risk.js';

const settings = { nudgeThreshold: 45, verifyThreshold: 75 };

const safe: RiskFeatures = {
  orderValuePaise: 899_00,
  customer: { ordersCount: 5, deliveredCount: 4, rtoCount: 0 },
  pincode: { delivered: 200, rto: 10 },
  hasValidPhone: true,
  address1: 'Flat 4B, Lotus Apartments, 2nd Main Road',
  maxLineQuantity: 1,
  placedHourIst: 14,
};

describe('COD risk score', () => {
  it('lets trusted repeat customers in good pincodes pay COD', () => {
    const r = scoreCodRisk(safe, settings);
    expect(r.action).toBe('allow');
    expect(r.score).toBeLessThan(45);
  });

  it('nudges risky first-time high-value orders to prepaid', () => {
    const r = scoreCodRisk(
      { ...safe, customer: null, orderValuePaise: 3500_00, pincode: { delivered: 20, rto: 15 } },
      settings,
    );
    expect(['nudge_prepaid', 'partial_cod']).toContain(r.action);
    expect(r.reasons.some((x) => x.includes('first-time'))).toBe(true);
  });

  it('asks for partial COD on very risky orders', () => {
    const r = scoreCodRisk(
      {
        ...safe,
        customer: { ordersCount: 4, deliveredCount: 1, rtoCount: 2 },
        pincode: { delivered: 5, rto: 20 },
        orderValuePaise: 7000_00,
        address1: 'near temple',
        maxLineQuantity: 5,
        placedHourIst: 2,
      },
      settings,
    );
    expect(r.action).toBe('partial_cod');
    expect(r.score).toBeGreaterThanOrEqual(75);
  });

  it('blocks COD for serial RTO customers and verifies invalid phones', () => {
    expect(scoreCodRisk({ ...safe, customer: { ordersCount: 3, deliveredCount: 0, rtoCount: 3 } }, settings).action).toBe('block_cod');
    expect(scoreCodRisk({ ...safe, hasValidPhone: false }, settings).action).toBe('verify');
  });

  it('smooths sparse pincode data instead of trusting 1 bad delivery', () => {
    const oneBad = scoreCodRisk({ ...safe, pincode: { delivered: 0, rto: 1 } }, settings);
    expect(oneBad.score).toBeLessThan(45);
  });

  it('keeps the score within 0-100', () => {
    const r = scoreCodRisk({ ...safe, customer: { ordersCount: 10, deliveredCount: 10, rtoCount: 0 }, orderValuePaise: 100_00 }, settings);
    expect(r.score).toBeGreaterThanOrEqual(0);
  });

  it('converts UTC to IST hour correctly', () => {
    expect(istHour(new Date('2026-10-01T20:00:00Z'))).toBe(1); // 01:30 IST
    expect(istHour(new Date('2026-10-01T18:29:00Z'))).toBe(23); // 23:59 IST
  });
});
