import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type Me } from '../api';
import { useSession } from '../session';
import { IconCopy } from '../components/Icons';

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="field">
      <span className="lbl">{label}</span>
      <div className="copy">
        <code>{value}</code>
        <button className="btn btn-ghost btn-sm on-light" type="button" aria-label={`Copy ${label}`}
          onClick={() => { void navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>
          <IconCopy />{copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

export function Connect() {
  const { me, store, setMe, setStoreId } = useSession();
  const [params, setParams] = useSearchParams();
  const claim = params.get('claim');
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);
  const claimed = useRef(false);

  // Finish an install that started in the Shopify App Store.
  useEffect(() => {
    if (!claim || claimed.current) return;
    claimed.current = true;
    api.post<{ stores: Me['stores'] }>('/app-api/stores/claim', { token: claim })
      .then((r) => {
        if (me) setMe({ ...me, stores: r.stores });
        const newest = r.stores[r.stores.length - 1];
        if (newest) setStoreId(newest.id);
        setBanner({ ok: true, text: 'Your Shopify store is connected to this account.' });
      })
      .catch((e: unknown) => setBanner({ ok: false, text: e instanceof Error ? e.message : 'Could not link the store.' }))
      .finally(() => setParams({}, { replace: true }));
  }, [claim]); // eslint-disable-line react-hooks/exhaustive-deps

  const [shop, setShop] = useState('');
  const [shopErr, setShopErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function connect(e: FormEvent) {
    e.preventDefault();
    if (!shop.trim()) return setShopErr('Enter your Shopify store address.');
    setBusy(true);
    setShopErr(null);
    try {
      const { url } = await api.post<{ url: string }>('/app-api/shopify/connect', { shop: shop.trim() });
      window.location.assign(url);
    } catch (err) {
      setShopErr(err instanceof Error ? err.message : 'Could not start the connection.');
      setBusy(false);
    }
  }

  const [awbMsg, setAwbMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function addAwb(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!store) return;
    const f = new FormData(e.currentTarget);
    const orderNumber = String(f.get('order') ?? '').trim();
    const awb = String(f.get('awb') ?? '').trim();
    if (!orderNumber || awb.length < 3) return setAwbMsg({ ok: false, text: 'Enter the order number and the AWB.' });
    try {
      await api.post(`/app-api/stores/${store.id}/shipments`, { orderNumber, awb, courier: 'shiprocket' });
      setAwbMsg({ ok: true, text: `AWB ${awb} is now tracked for ${orderNumber.startsWith('#') ? orderNumber : `#${orderNumber}`}.` });
      (e.target as HTMLFormElement).reset();
    } catch (err) {
      setAwbMsg({ ok: false, text: err instanceof Error ? err.message : 'Could not add the AWB.' });
    }
  }

  const origin = window.location.origin;
  return (
    <>
      <div className="page-head"><div><h1>Connections</h1><p>Your store, courier and payments — the three things ReRoute needs.</p></div></div>
      {banner ? <div className={`banner ${banner.ok ? 'good' : 'bad'}`} role="status">{banner.text}</div> : null}

      <div className="grid two" style={{ alignItems: 'start' }}>
        <section className="card form-grid" aria-labelledby="shop-h">
          <div className="card-head" style={{ marginBottom: 0 }}><h2 id="shop-h">1 · Store</h2><span>Shopify</span></div>
          {me?.stores.length ? (
            <ul className="list">
              {me.stores.map((s) => (
                <li key={s.id}><span className="dot" style={{ background: s.status === 'active' ? 'var(--rr-lime)' : 'var(--rr-mist)', boxShadow: '0 0 0 1px rgba(14,27,44,.2)' }} />
                  <div><b>{s.name ?? s.shopDomain}</b><div className="meta">{s.platform} · {s.shopDomain}</div></div>
                  <span className="pill outline">{s.role}</span></li>
              ))}
            </ul>
          ) : <p style={{ color: 'var(--rr-slate)' }}>No store connected yet.</p>}
          {me?.integrations && !me.integrations.shopify ? (
            <div className="banner info" role="note">Shopify isn’t set up on this server yet. Add <code className="mono">SHOPIFY_API_KEY</code> and <code className="mono">SHOPIFY_API_SECRET</code> in your hosting settings (see DEPLOY.md, step 6).</div>
          ) : null}
          <form onSubmit={connect} className="form-grid on-light" noValidate>
            <div className="field">
              <label htmlFor="shop">Connect a Shopify store</label>
              <input id="shop" className="input" placeholder="your-store.myshopify.com" value={shop} onChange={(e) => setShop(e.target.value)} aria-invalid={!!shopErr} autoCapitalize="none" autoCorrect="off" />
              <span className="hint">You’ll approve access on Shopify, then come straight back here.</span>
            </div>
            {shopErr ? <p className="err" role="alert">{shopErr}</p> : null}
            <button className="btn btn-ink" disabled={busy} type="submit">{busy ? 'Opening Shopify…' : 'Connect Shopify'}</button>
          </form>
        </section>

        <section className="card form-grid" aria-labelledby="hooks-h">
          <div className="card-head" style={{ marginBottom: 0 }}><h2 id="hooks-h">2 · Courier & payments</h2><span>one-time setup</span></div>
          <p style={{ color: 'var(--rr-slate)', fontSize: 15, lineHeight: 1.55 }}>Paste these into your Shiprocket and Razorpay dashboards so ReRoute hears about failed deliveries and payments instantly.</p>
          {me?.integrations ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(['shiprocket', 'razorpay', 'whatsapp'] as const).map((k) => (
                <span key={k} className={`pill ${me.integrations![k] ? 'lime' : 'grey'}`}>{k[0]!.toUpperCase() + k.slice(1)} {me.integrations![k] ? '· ready' : '· not set up'}</span>
              ))}
            </div>
          ) : null}
          <CopyField label="Shiprocket tracking webhook" value={`${origin}/webhooks/courier/shiprocket`} />
          <CopyField label="Razorpay webhook (payment_link.paid, .expired, .cancelled)" value={`${origin}/webhooks/razorpay`} />
          <p style={{ color: 'var(--rr-slate)', fontSize: 13.5 }}>Use the webhook secrets from your ReRoute onboarding call. Never share them in chat or email.</p>
        </section>
      </div>

      {store && store.role !== 'viewer' ? (
        <section className="card" style={{ marginTop: 16, maxWidth: 760 }} aria-labelledby="awb-h">
          <div className="card-head"><h2 id="awb-h">3 · Track a shipment manually</h2><span>optional</span></div>
          <p style={{ color: 'var(--rr-slate)', fontSize: 15, marginBottom: 14 }}>Shiprocket shipments are picked up automatically. Use this for a parcel you booked another way.</p>
          <form className="row2 on-light" onSubmit={addAwb} noValidate>
            <div className="field"><label htmlFor="order">Order number</label><input id="order" name="order" className="input" placeholder="#1042" /></div>
            <div className="field"><label htmlFor="awb">AWB</label><input id="awb" name="awb" className="input mono" placeholder="SR700123" autoCapitalize="characters" /></div>
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', gridColumn: '1 / -1', flexWrap: 'wrap' }}>
              <button className="btn btn-ink" type="submit">Track shipment</button>
              {awbMsg ? <span className={awbMsg.ok ? 'ok' : 'err'} role="status">{awbMsg.text}</span> : null}
            </div>
          </form>
        </section>
      ) : null}
    </>
  );
}
