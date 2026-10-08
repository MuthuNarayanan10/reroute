import { useMemo, useState } from 'react';
import { dateShort, inr, inrCompact } from '../format';

interface Point { day: string; paise: number; parcels: number }

/** Single-series daily bar chart for the dark card. Lime bars on ink; values on hover/focus; table for screen readers. */
export function BarChart({ data }: { data: Point[] }) {
  const [active, setActive] = useState<number | null>(null);
  const W = 720, H = 220, PADL = 52, PADB = 28, PADT = 12;
  const max = useMemo(() => niceMax(Math.max(0, ...data.map((d) => d.paise))), [data]);
  const bw = (W - PADL) / Math.max(1, data.length);
  const y = (v: number) => PADT + (H - PADT - PADB) * (1 - v / max);
  const ticks = [0, max / 2, max];
  const sel = active != null ? data[active] : null;

  return (
    <div>
      <div style={{ minHeight: 22, fontSize: 14, color: 'rgba(255,255,255,.8)' }} aria-live="polite">
        {sel ? <><b style={{ color: 'var(--rr-lime)' }}>{inr(sel.paise)}</b> rescued on {dateShort(sel.day)} · {sel.parcels} parcel{sel.parcels === 1 ? '' : 's'}</> : 'Hover or tap a bar for the day’s detail.'}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Rupees rescued per day over the last 30 days" style={{ marginTop: 8 }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PADL} x2={W} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,.1)" />
            <text x={PADL - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="rgba(255,255,255,.5)" fontFamily="JetBrains Mono, monospace">{inrCompact(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const h = Math.max(d.paise > 0 ? 3 : 0, H - PADB - y(d.paise));
          return (
            <g key={d.day} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(i)} onBlur={() => setActive(null)} onClick={() => setActive(i)} tabIndex={0} aria-label={`${dateShort(d.day)}: ${inr(d.paise)}`} style={{ outline: 'none', cursor: 'pointer' }}>
              <rect x={PADL + i * bw} y={PADT} width={bw} height={H - PADT - PADB} fill="transparent" />
              <rect x={PADL + i * bw + bw * 0.18} y={H - PADB - h} width={bw * 0.64} height={h} rx={3} fill={active === i ? '#E4FF8A' : 'var(--rr-lime)'} opacity={active == null || active === i ? 1 : 0.55} />
              {i % 7 === 0 || i === data.length - 1 ? (
                <text x={PADL + i * bw + bw / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="rgba(255,255,255,.5)" fontFamily="JetBrains Mono, monospace">{dateShort(d.day)}</text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>Rupees rescued per day</caption>
        <tbody>{data.map((d) => <tr key={d.day}><td>{d.day}</td><td>{inr(d.paise)}</td><td>{d.parcels} parcels</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function niceMax(v: number): number {
  if (v <= 0) return 100000; // ₹1,000 axis when empty
  const mag = 10 ** Math.floor(Math.log10(v));
  const n = v / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}
