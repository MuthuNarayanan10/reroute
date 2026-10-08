import { useEffect, useState, type ReactNode } from 'react';
import { api, type StoreDetail, type StoreSettings } from '../api';
import { useApi, useSession } from '../session';
import { inr } from '../format';
import { ErrorBox, Skeleton } from '../components/ui';
import { NoStore } from './NoStore';

function Switch({ id, label, hint, checked, onChange, disabled }: { id: string; label: string; hint: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="switch">
      <div><label htmlFor={id} className="lbl" style={{ fontWeight: 700 }}>{label}</label><div className="hint" style={{ color: 'var(--rr-slate)', fontSize: 13.5, marginTop: 4 }}>{hint}</div></div>
      <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
    </div>
  );
}

function Range({ id, label, hint, value, min, max, step = 1, fmt, onChange, disabled }: { id: string; label: string; hint: ReactNode; value: number; min: number; max: number; step?: number; fmt: (v: number) => string; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="range-row"><input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} disabled={disabled} /><output htmlFor={id}>{fmt(value)}</output></div>
      <span className="hint">{hint}</span>
    </div>
  );
}

export function Settings() {
  const { store } = useSession();
  const { data, error, loading, reload } = useApi<StoreDetail>(store ? `/app-api/stores/${store.id}` : null);
  const [s, setS] = useState<StoreSettings | null>(null);
  const [skus, setSkus] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (data) { setS(data.settings); setSkus(data.settings.rerouteExcludedSkus.join('\n')); }
  }, [data]);
  if (!store) return <NoStore />;
  const readOnly = store.role === 'viewer';
  const set = <K extends keyof StoreSettings>(k: K, v: StoreSettings[K]) => { setS((p) => (p ? { ...p, [k]: v } : p)); setMsg(null); };
  const dirty = !!(data && s && (JSON.stringify({ ...s, rerouteExcludedSkus: parseSkus(skus) }) !== JSON.stringify(data.settings)));

  async function save() {
    if (!s || !store) return;
    if (s.verifyThreshold <= s.nudgeThreshold) return setMsg({ ok: false, text: 'The partial-COD score must be higher than the prepaid-nudge score.' });
    setSaving(true);
    setMsg(null);
    try {
      await api.patch(`/app-api/stores/${store.id}/settings`, { ...s, rerouteExcludedSkus: parseSkus(skus) });
      setMsg({ ok: true, text: 'Settings saved. New orders use them right away.' });
      reload();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'Could not save.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="page-head"><div><h1>Settings</h1><p>Tune how ReRoute treats risky COD orders and failed deliveries.</p></div></div>
      {readOnly ? <div className="banner info">You have view-only access to this store. Ask an owner to change settings.</div> : null}
      {error ? <ErrorBox message={error} onRetry={reload} /> : null}
      {loading || !s ? <div className="card"><Skeleton h={360} /></div> : (
        <div className="grid two" style={{ alignItems: 'start' }}>
          <section className="card form-grid" aria-labelledby="cod-h">
            <h2 id="cod-h">COD → prepaid</h2>
            <Switch id="cod-on" label="Offer prepaid to risky COD orders" hint="Sends a discounted UPI link on WhatsApp before dispatch." checked={s.codPrepaidEnabled} onChange={(v) => set('codPrepaidEnabled', v)} disabled={readOnly} />
            <Range id="nudge" label="Prepaid nudge from risk score" value={s.nudgeThreshold} min={10} max={90} fmt={String} onChange={(v) => set('nudgeThreshold', v)} disabled={readOnly} hint="Orders at or above this score get the prepaid offer." />
            <Range id="verify" label="Ask for partial COD from risk score" value={s.verifyThreshold} min={20} max={100} fmt={String} onChange={(v) => set('verifyThreshold', v)} disabled={readOnly} hint="Very risky orders are tagged for a small upfront payment." />
            <Range id="pp-disc" label="Prepaid discount" value={s.prepaidDiscountPaise} min={0} max={20000} step={500} fmt={inr} onChange={(v) => set('prepaidDiscountPaise', v)} disabled={readOnly} hint="Capped at 20% of the order value." />
          </section>

          <section className="card form-grid" aria-labelledby="rr-h">
            <h2 id="rr-h">ReRoute</h2>
            <Switch id="rr-on" label="Rescue failed deliveries" hint="Offer failed COD parcels to opted-in shoppers nearby." checked={s.rerouteEnabled} onChange={(v) => set('rerouteEnabled', v)} disabled={readOnly} />
            <Range id="rr-disc" label="Nearby-buyer discount" value={s.rerouteDiscountBps} min={0} max={3000} step={100} fmt={(v) => `${v / 100}%`} onChange={(v) => set('rerouteDiscountBps', v)} disabled={readOnly} hint={<>A ₹1,299 item is offered at <b>{inr(Math.floor((129900 * (10000 - s.rerouteDiscountBps)) / 1000000) * 100)}</b>.</>} />
            <Range id="rr-min" label="Minimum order value to reroute" value={s.rerouteMinOrderPaise} min={0} max={500000} step={5000} fmt={inr} onChange={(v) => set('rerouteMinOrderPaise', v)} disabled={readOnly} hint="Below this, the courier fee usually outweighs the rescue." />
            <div className="field">
              <label htmlFor="skus">Never reroute these SKUs</label>
              <textarea id="skus" className="textarea" value={skus} onChange={(e) => { setSkus(e.target.value); setMsg(null); }} placeholder={'One SKU per line, e.g.\nPERISHABLE-01\nCUSTOM-NAME-TEE'} disabled={readOnly} />
              <span className="hint">For perishable, personalised or intimate products.</span>
            </div>
          </section>
        </div>
      )}
      {!readOnly && s ? (
        <div className="save-bar">
          {msg ? <span className={msg.ok ? 'ok' : 'err'} role="status">{msg.text}</span> : dirty ? <span style={{ color: 'var(--rr-slate)', fontSize: 14 }}>You have unsaved changes.</span> : null}
          <button className="btn btn-ink" onClick={() => void save()} disabled={saving || !dirty}>{saving ? 'Saving…' : 'Save settings'}</button>
        </div>
      ) : null}
    </>
  );
}

function parseSkus(text: string): string[] {
  return [...new Set(text.split(/[\n,]/).map((x) => x.trim()).filter(Boolean))].slice(0, 1000);
}
