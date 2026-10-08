import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useSession } from '../session';
import { IconBox, IconHome, IconMenu, IconPlug, IconRoute, IconSliders } from './Icons';

const NAV = [
  { to: '/app', label: 'Overview', icon: IconHome, end: true },
  { to: '/app/orders', label: 'Orders', icon: IconBox },
  { to: '/app/reroute', label: 'ReRoute', icon: IconRoute },
  { to: '/app/settings', label: 'Settings', icon: IconSliders },
  { to: '/app/connect', label: 'Connections', icon: IconPlug },
];

export function Layout() {
  const { me, store, setStoreId, logout } = useSession();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);

  return (
    <div className="shell">
      <header className="topbar">
        <img src="/brand/reroute-logo-horizontal-on-dark.svg" alt="ReRoute" height={26} width={104} />
        <button onClick={() => setOpen((o) => !o)} aria-label="Open menu" aria-expanded={open} aria-controls="sidebar"><IconMenu /></button>
      </header>

      <aside className={`side${open ? ' open' : ''}`} id="sidebar">
        <a className="side-logo" href="/" aria-label="ReRoute website"><img src="/brand/reroute-logo-horizontal-on-dark.svg" alt="ReRoute" height={30} width={120} /></a>
        {me?.stores.length ? (
          <>
            <label className="sr-only" htmlFor="store-switch">Store</label>
            <select id="store-switch" className="store-switch" value={store?.id ?? ''} onChange={(e) => setStoreId(e.target.value)}>
              {me.stores.map((s) => <option key={s.id} value={s.id}>{s.name ?? s.shopDomain}</option>)}
            </select>
            <div className="store-meta">{store?.platform.toUpperCase()} · {store?.role.toUpperCase()}</div>
          </>
        ) : <div className="store-meta" style={{ marginTop: 0 }}>NO STORE CONNECTED</div>}
        <nav aria-label="Dashboard">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '')}><Icon />{label}</NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <div className="who">{me?.user.name}</div>
          <div className="email" title={me?.user.email}>{me?.user.email}</div>
          <button className="linkbtn" onClick={() => void logout()}>Log out</button>
        </div>
      </aside>

      <main className="main" id="main"><Outlet /></main>
    </div>
  );
}
