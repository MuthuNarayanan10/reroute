import { Fragment, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { OrderRow, Page } from '../api';
import { useApi, useSession } from '../session';
import { dateTime, inr } from '../format';
import { Empty, ErrorBox, RiskMeter, RiskPill, Skeleton } from '../components/ui';
import { NoStore } from './NoStore';

const VIEWS = [
  { id: 'all', label: 'All' },
  { id: 'cod', label: 'COD' },
  { id: 'risky', label: 'Risky' },
  { id: 'rerouted', label: 'Rerouted' },
] as const;
const PAGE = 25;

const STATUS: Record<string, string> = { open: 'Awaiting dispatch', fulfilled: 'In transit', delivered: 'Delivered', rto: 'Returned (RTO)', rerouted_out: 'Rerouted', cancelled: 'Cancelled' };
const MODE: Record<string, string> = { cod: 'COD', prepaid: 'Prepaid', partial_cod: 'Partial COD' };

export function Orders() {
  const { store } = useSession();
  const [params, setParams] = useSearchParams();
  const view = (params.get('view') ?? 'all') as (typeof VIEWS)[number]['id'];
  const page = Math.max(0, Number(params.get('page') ?? 0));
  const [q, setQ] = useState(params.get('q') ?? '');
  const [open, setOpen] = useState<string | null>(null);

  // Debounce search into the URL.
  useEffect(() => {
    const t = setTimeout(() => {
      const next = new URLSearchParams(params);
      if (q) next.set('q', q); else next.delete('q');
      next.delete('page');
      if (next.toString() !== params.toString()) setParams(next, { replace: true });
    }, 300);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const path = store ? `/app-api/stores/${store.id}/orders?view=${view}&limit=${PAGE}&offset=${page * PAGE}${params.get('q') ? `&q=${encodeURIComponent(params.get('q')!)}` : ''}` : null;
  const { data, error, loading, reload } = useApi<Page<OrderRow>>(path);
  if (!store) return <NoStore />;

  const setView = (v: string) => { const n = new URLSearchParams(params); n.set('view', v); n.delete('page'); setParams(n); };
  const setPage = (p: number) => { const n = new URLSearchParams(params); n.set('page', String(p)); setParams(n); };
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;

  return (
    <>
      <div className="page-head"><div><h1>Orders</h1><p>Every order with its COD risk score and the reasons behind it.</p></div></div>
      <div className="toolbar">
        <div className="tabs" role="tablist" aria-label="Filter orders">
          {VIEWS.map((v) => <button key={v.id} role="tab" aria-selected={view === v.id} onClick={() => setView(v.id)}>{v.label}</button>)}
        </div>
        <label className="sr-only" htmlFor="order-search">Search by order number</label>
        <input id="order-search" className="search" placeholder="Search order #" value={q} onChange={(e) => setQ(e.target.value)} inputMode="numeric" />
      </div>
      {error ? <ErrorBox message={error} onRetry={reload} /> : null}
      <div className="card">
        {loading && !data ? <Skeleton h={320} /> : !data || data.items.length === 0 ? (
          <Empty title={params.get('q') ? 'No matching orders' : 'No orders yet'}>{params.get('q') ? 'Try a different order number.' : 'Orders appear here as soon as your store sends them.'}</Empty>
        ) : (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Order</th><th>Placed</th><th>Customer</th><th>Payment</th><th className="num">Total</th><th>Risk</th><th>Action</th><th>Status</th></tr></thead>
              <tbody>
                {data.items.map((o) => (
                  <Fragment key={o.id}>
                    <tr className="clickable" onClick={() => setOpen(open === o.id ? null : o.id)} aria-expanded={open === o.id}>
                      <td className="strong">{o.orderNumber}</td>
                      <td>{dateTime(o.placedAt)}</td>
                      <td>{o.customer || '—'}<div style={{ color: 'var(--rr-slate)', fontSize: 13 }}>{o.city} {o.pincode}</div></td>
                      <td>{MODE[o.paymentMode]}{o.prepaidOffer === 'paid' ? <div style={{ fontSize: 12.5, color: '#1E6B2E', fontWeight: 700 }}>converted ✓</div> : o.prepaidOffer === 'sent' ? <div style={{ fontSize: 12.5, color: 'var(--rr-slate)' }}>offer sent</div> : null}</td>
                      <td className="num">{inr(o.totalPaise)}</td>
                      <td><RiskMeter score={o.riskScore} /></td>
                      <td><RiskPill action={o.riskAction} /></td>
                      <td>{STATUS[o.status] ?? o.status}</td>
                    </tr>
                    {open === o.id ? (
                      <tr><td colSpan={8} style={{ background: '#FBFCF8' }}>
                        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 6 }}>Why this score</div>
                        {o.riskReasons?.length ? <div className="reasons">{o.riskReasons.map((r) => <span key={r}>{r}</span>)}</div> : <span style={{ color: 'var(--rr-slate)' }}>Prepaid orders aren’t scored.</span>}
                      </td></tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > PAGE ? (
          <div className="pager">
            <span>{page * PAGE + 1}–{Math.min(data.total, (page + 1) * PAGE)} of {data.total}</span>
            <span style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost btn-sm on-light" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
              <button className="btn btn-ghost btn-sm on-light" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</button>
            </span>
          </div>
        ) : null}
      </div>
    </>
  );
}
