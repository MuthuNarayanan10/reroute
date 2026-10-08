import { useSearchParams } from 'react-router-dom';
import type { CaseRow, CaseStatus, Page } from '../api';
import { useApi, useSession } from '../session';
import { ago, dateTime, inr, inrCompact } from '../format';
import { CasePill, Empty, ErrorBox, Skeleton } from '../components/ui';
import { NoStore } from './NoStore';

type Cases = Page<CaseRow> & { byStatus: Array<{ status: CaseStatus; n: number }> };
const ORDER: CaseStatus[] = ['completed', 'offered', 'claimed', 'expired', 'no_match', 'ineligible', 'failed'];
const LABEL: Record<CaseStatus, string> = { completed: 'Rescued', offered: 'Live', claimed: 'Paid', expired: 'Expired', no_match: 'No match', ineligible: 'Not eligible', failed: 'Failed', evaluating: 'Checking' };
const PAGE = 25;

export function Reroute() {
  const { store } = useSession();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') as CaseStatus | null;
  const page = Math.max(0, Number(params.get('page') ?? 0));
  const path = store ? `/app-api/stores/${store.id}/reroute/cases?limit=${PAGE}&offset=${page * PAGE}${status ? `&status=${status}` : ''}` : null;
  const { data, error, loading, reload } = useApi<Cases>(path);
  if (!store) return <NoStore />;

  const counts = Object.fromEntries((data?.byStatus ?? []).map((b) => [b.status, b.n])) as Partial<Record<CaseStatus, number>>;
  const totalCases = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
  const rescued = counts.completed ?? 0;
  const tried = totalCases - (counts.ineligible ?? 0);
  const setStatus = (s: CaseStatus | null) => { const n = new URLSearchParams(); if (s) n.set('status', s); setParams(n); };
  const setPage = (p: number) => { const n = new URLSearchParams(params); n.set('page', String(p)); setParams(n); };

  return (
    <>
      <div className="page-head">
        <div><h1>ReRoute</h1><p>Every failed delivery, and what happened to it.</p></div>
        {data ? <div className="mono" style={{ color: 'var(--rr-slate)' }}>Rescue rate <b style={{ color: 'var(--rr-ink)' }}>{tried ? Math.round((rescued / tried) * 100) : 0}%</b> of eligible parcels</div> : null}
      </div>

      <div className="tabs" role="tablist" aria-label="Filter by outcome" style={{ marginBottom: 16 }}>
        <button role="tab" aria-selected={!status} onClick={() => setStatus(null)}>All {totalCases ? `· ${totalCases}` : ''}</button>
        {ORDER.filter((s) => counts[s]).map((s) => (
          <button key={s} role="tab" aria-selected={status === s} onClick={() => setStatus(s)}>{LABEL[s]} · {counts[s]}</button>
        ))}
      </div>

      {error ? <ErrorBox message={error} onRetry={reload} /> : null}
      <div className="card">
        {loading && !data ? <Skeleton h={320} /> : !data || data.items.length === 0 ? (
          <Empty title="No failed deliveries yet">When a courier reports a failed COD delivery, ReRoute opens a case here and starts looking for a nearby buyer.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Order</th><th>Outcome</th><th>Opened</th><th>AWB</th><th className="num">Offers</th><th className="num">Offer price</th><th className="num">Rescued</th><th>Details</th></tr></thead>
              <tbody>
                {data.items.map((c) => (
                  <tr key={c.id}>
                    <td className="strong">{c.orderNumber}<div style={{ color: 'var(--rr-slate)', fontSize: 13, fontWeight: 400 }}>{inr(c.orderTotalPaise)} · {c.fromPincode}</div></td>
                    <td><CasePill status={c.status} /></td>
                    <td>{dateTime(c.createdAt)}</td>
                    <td className="mono" style={{ fontSize: 13 }}>{c.awb}<div style={{ color: 'var(--rr-slate)' }}>{c.courier}</div></td>
                    <td className="num">{c.offersSent || '—'}</td>
                    <td className="num">{c.offerPricePaise ? inr(c.offerPricePaise) : '—'}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{c.savedPaise ? inrCompact(c.savedPaise) : '—'}</td>
                    <td style={{ fontSize: 13.5, color: 'var(--rr-slate)', maxWidth: 280 }}>
                      {c.status === 'completed' ? <>Sold to a buyer {c.winnerKm != null ? `${c.winnerKm} km away` : 'nearby'} · {ago(c.updatedAt)}</>
                        : c.status === 'offered' ? <>Offers close {ago(c.deadlineAt)}</>
                        : c.reason ?? '—'}
                    </td>
                  </tr>
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
              <button className="btn btn-ghost btn-sm on-light" disabled={(page + 1) * PAGE >= data.total} onClick={() => setPage(page + 1)}>Next</button>
            </span>
          </div>
        ) : null}
      </div>
      <p style={{ marginTop: 14, fontSize: 14, color: 'var(--rr-slate)' }}>Only unpaid COD parcels are rerouted. Prepaid orders are marked “Not eligible” because the original buyer would need a refund first.</p>
    </>
  );
}
