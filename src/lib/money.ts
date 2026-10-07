/** All money is integer paise. 1 INR = 100 paise. Never use floats for money. */

export function rupeesStringToPaise(value: string | number): number {
  const s = typeof value === 'number' ? value.toFixed(2) : value.trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw new Error(`Invalid money amount: ${value}`);
  const negative = s.startsWith('-');
  const [whole, frac = ''] = s.replace('-', '').split('.');
  const paise = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return negative ? -paise : paise;
}

export function paiseToRupeesString(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Apply a discount in basis points (1000 bps = 10%), rounding down to whole rupees. */
export function applyDiscountBps(paise: number, bps: number): number {
  const discounted = Math.floor((paise * (10_000 - bps)) / 10_000);
  return Math.floor(discounted / 100) * 100;
}

export function formatInr(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}
