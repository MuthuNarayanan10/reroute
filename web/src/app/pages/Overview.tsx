import { Link, useLocation } from 'react-router-dom';
import type { Overview as OverviewData } from '../api';
import { useApi, useSession } from '../session';
import { ago, inr, inrCompact, pct } from '../format';
import { BarChart } from '../components/BarChart';
import { CasePill, Empty, ErrorBox, Kpi, RiskPill, Skeleton } from '../components/ui';
import { NoStore } from './NoStore';

function greeting() {
  const h = Number(new Date().toLocaleString('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function Overview() {
  const { me, store } = useSession();
  const connected = new URLSearchParams(useLocation().search).get('connected');
  const { data, error, loading, reload } = useApi<OverviewData>(store ? `/app-api/stores/${store.id}/overview` : null);
  if (!store) return <NoStore />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{greeting()}, {me?.user.name.split(' ')[0]}</h1>
          <p>{store.name ?? store.shopDomain} · last 30 days</p>
        </div>
        <Link className="btn btn-ghost btn-sm on-light" to="/app/reroute">View ReRoute cases</Link>
      </div>

      {connected ? <div className="banner good" role="status">{connected} is connected. New orders will appear here within seconds.</div> : null}
      {error ? <ErrorBox message={error} onRetry={reload} /> : null}

      <div className="grid kpis">
        {loading || !data ? (
          [0, 1, 2, 3].map((i) => <div className="card kpi" key={i}><Skeleton h={12} w={110} /><div style={{ height: 14 }} /><Skeleton h={36} w={140} /><div style={{ height: 12 }} /><Skeleton h={12} w={160} /></div>)
        ) : (
          <>
            <Kpi hero label="₹ rescued · 30 days" value={inrCompact(data.rescued.paise)} sub={`${data.rescued.parcels} parcel${data.rescued.parcels === 1 ? '' : 's'} didn’t go back · ${inrCompact(data.rescued.monthPaise)} this month`} />
            <Kpi label="COD → prepaid" value={pct(data.prepaid.rate)} sub={`${data.prepaid.paid} of ${data.prepaid.sent} offers paid · ${inrCompact(data.prepaid.paidPaise)}`} />
            <Kpi label="RTO rate" value={pct(data.orders30d.rtoRate, 1)} sub={`of delivered + returned orders · industry 25–30% on COD`} />
            <Kpi label="Live offers" value={data.rescued.liveOffers} sub={`${data.orders30d.total} orders · ${pct(data.orders30d.codShare)} COD`} />
          </>
        )}
      </div>

      <div className="grid two" style={{ marginTop: 16, alignItems: 'start' }}>
        <section className="card dark" aria-labelledby="chart-h">
          <div className="card-head"><h2 id="chart-h">Daily ₹ rescued</h2><span>last 30 days, IST</span></div>
          {data ? <BarChart data={data.daily} /> : <Skeleton h={220} />}
        </section>

        <section className="card" aria-labelledby="ndr-h">
          <div className="card-head"><h2 id="ndr-h">Failed deliveries now</h2><span>{data?.needsAction.ndr.length ?? 0} open</span></div>
          {!data ? <Skeleton h={180} /> : data.needsAction.ndr.length === 0 ? (
            <Empty title="No failed deliveries">When a courier reports an NDR, ReRoute starts finding a buyer here.</Empty>
          ) : (
            <ul className="list">
              {data.needsAction.ndr.map((n) => (
                <li key={n.shipmentId}>
                  <span className="dot" style={{ background: n.caseStatus === 'completed' ? 'var(--rr-lime)' : 'var(--rr-coral)' }} />
                  <div>
                    <div><b>{n.orderNumber}</b> · {inr(n.totalPaise)} · {n.pincode}</div>
                    <div className="meta">{n.reason ?? 'Delivery failed'} · AWB {n.awb}</div>
                  </div>
                  <div className="when">{n.caseStatus ? <CasePill status={n.caseStatus} /> : <span className="pill grey">Queued</span>}<div style={{ marginTop: 4 }}>{ago(n.at)}</div></div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card" style={{ marginTop: 16 }} aria-labelledby="risky-h">
        <div className="card-head"><h2 id="risky-h">Risky COD orders awaiting dispatch</h2><Link to="/app/orders?view=risky">See all</Link></div>
        {!data ? <Skeleton h={120} /> : data.needsAction.risky.length === 0 ? (
          <Empty title="Nothing risky waiting">High-risk COD orders show up here before they ship, so you can call or ask for prepaid.</Empty>
        ) : (
          <ul className="list">
            {data.needsAction.risky.map((r) => (
              <li key={r.orderId}>
                <span className="dot" style={{ background: (r.riskScore ?? 0) >= 75 ? 'var(--rr-coral)' : '#E9A23B' }} />
                <div><div><b>{r.orderNumber}</b> · {inr(r.totalPaise)} · {r.pincode}</div><div className="meta">Risk score {r.riskScore} / 100</div></div>
                <div className="when"><RiskPill action={r.riskAction} /><div style={{ marginTop: 4 }}>{ago(r.at)}</div></div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
