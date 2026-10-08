import '../fonts';
import './app.css';
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { SessionProvider, useSession } from './session';
import { Layout } from './components/Layout';
import { Login, Signup } from './pages/Auth';
import { Overview } from './pages/Overview';
import { Orders } from './pages/Orders';
import { Reroute } from './pages/Reroute';
import { Settings } from './pages/Settings';
import { Connect } from './pages/Connect';
import { Empty } from './components/ui';

function RequireAuth({ children }: { children: ReactNode }) {
  const { loading, me } = useSession();
  const loc = useLocation();
  if (loading) return <div className="empty" role="status">Loading your dashboard…</div>;
  if (!me) return <Navigate to={`/app/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { loading, me } = useSession();
  const next = new URLSearchParams(useLocation().search).get('next');
  if (loading) return null;
  if (me) return <Navigate to={next && next.startsWith('/app') ? next : '/app'} replace />;
  return <>{children}</>;
}

function App() {
  return (
    <Routes>
      <Route path="/app/login" element={<GuestOnly><Login /></GuestOnly>} />
      <Route path="/app/signup" element={<GuestOnly><Signup /></GuestOnly>} />
      <Route path="/app" element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<Overview />} />
        <Route path="orders" element={<Orders />} />
        <Route path="reroute" element={<Reroute />} />
        <Route path="settings" element={<Settings />} />
        <Route path="connect" element={<Connect />} />
        <Route path="*" element={<Empty title="Page not found" action={<a className="btn btn-ink" href="/app">Back to overview</a>} />} />
      </Route>
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider><App /></SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);
