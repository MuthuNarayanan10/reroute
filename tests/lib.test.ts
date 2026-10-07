import { describe, expect, it } from 'vitest';
import { applyDiscountBps, paiseToRupeesString, rupeesStringToPaise } from '../src/lib/money.js';
import { toE164India } from '../src/lib/phone.js';
import { boundingBox, distanceKm, isValidPincode } from '../src/lib/geo.js';
import { decrypt, encrypt, hmacSha256, safeEqual } from '../src/lib/crypto.js';
import { maskEmail, maskPhone } from '../src/lib/mask.js';

describe('money', () => {
  it('parses rupee strings into integer paise without float errors', () => {
    expect(rupeesStringToPaise('1299.99')).toBe(129999);
    expect(rupeesStringToPaise('0.1')).toBe(10);
    expect(rupeesStringToPaise('500')).toBe(50000);
    expect(rupeesStringToPaise(19.9)).toBe(1990);
    expect(() => rupeesStringToPaise('abc')).toThrow();
  });
  it('formats paise back to rupees', () => {
    expect(paiseToRupeesString(129999)).toBe('1299.99');
    expect(paiseToRupeesString(5)).toBe('0.05');
  });
  it('applies a basis-point discount rounded down to whole rupees', () => {
    expect(applyDiscountBps(129900, 1000)).toBe(116900); // 10% off ₹1299 = ₹1169.10 -> ₹1169
    expect(applyDiscountBps(100000, 0)).toBe(100000);
  });
});

describe('phone', () => {
  it('normalises Indian numbers to E.164', () => {
    expect(toE164India('98765 43210')).toBe('+919876543210');
    expect(toE164India('+91-9876543210')).toBe('+919876543210');
    expect(toE164India('09876543210')).toBe('+919876543210');
  });
  it('rejects invalid numbers', () => {
    expect(toE164India('12345')).toBeNull();
    expect(toE164India('5876543210')).toBeNull(); // Indian mobiles start 6-9
    expect(toE164India(null)).toBeNull();
  });
});

describe('geo', () => {
  it('computes realistic distances', () => {
    const chennaiCentral = { lat: 13.0827, lng: 80.2707 };
    const tNagar = { lat: 13.0418, lng: 80.2341 };
    const d = distanceKm(chennaiCentral, tNagar);
    expect(d).toBeGreaterThan(5);
    expect(d).toBeLessThan(7);
  });
  it('builds a bounding box that contains points inside the radius', () => {
    const c = { lat: 12.97, lng: 77.59 };
    const b = boundingBox(c, 10);
    expect(b.minLat).toBeLessThan(c.lat);
    expect(b.maxLng).toBeGreaterThan(c.lng);
  });
  it('validates pincodes', () => {
    expect(isValidPincode('600001')).toBe(true);
    expect(isValidPincode('060001')).toBe(false);
    expect(isValidPincode('6000')).toBe(false);
  });
});

describe('crypto', () => {
  const key = 'a'.repeat(64);
  it('round-trips AES-GCM encryption', () => {
    const enc = encrypt('shpat_secret_token', key);
    expect(enc).not.toContain('shpat');
    expect(decrypt(enc, key)).toBe('shpat_secret_token');
  });
  it('detects tampering', () => {
    const enc = encrypt('hello', key);
    const [iv, tag, data] = enc.split('.');
    const tampered = [iv, tag, Buffer.from('evil').toString('base64')].join('.');
    expect(() => decrypt(tampered, key)).toThrow();
    expect(data).toBeTruthy();
  });
  it('compares in constant time and handles length mismatch', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(hmacSha256('k', 'msg', 'hex')).toHaveLength(64);
  });
});

describe('masking', () => {
  it('never exposes full PII', () => {
    expect(maskPhone('+919876543210')).toBe('+91******10');
    expect(maskEmail('muthu@example.com')).toBe('m***@example.com');
  });
});
