/** Normalise Indian phone numbers to E.164 (+91XXXXXXXXXX). Returns null if invalid. */
export function toE164India(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (!/^[6-9]\d{9}$/.test(digits)) return null;
  return `+91${digits}`;
}

/** WhatsApp Cloud API wants the number without '+'. */
export function toWhatsAppId(e164: string): string {
  return e164.replace(/^\+/, '');
}
