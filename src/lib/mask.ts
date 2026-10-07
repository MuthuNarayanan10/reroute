/** Masking helpers so logs and dashboards never show full PII. */
export function maskPhone(p: string | null | undefined): string {
  if (!p) return '';
  return p.length <= 4 ? '****' : `${p.slice(0, 3)}******${p.slice(-2)}`;
}

export function maskEmail(e: string | null | undefined): string {
  if (!e) return '';
  const [user, domain] = e.split('@');
  if (!user || !domain) return '***';
  return `${user[0]}***@${domain}`;
}

export function maskName(n: string | null | undefined): string {
  if (!n) return '';
  return n
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part[0]}.`)
    .join(' ');
}
