import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, type Me } from '../api';
import { useSession } from '../session';

function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <section className="auth-art">
        <a href="/" aria-label="ReRoute website"><img src="/brand/reroute-logo-horizontal-on-dark.svg" alt="ReRoute" height={34} width={136} /></a>
        <div>
          <h2>Every parcel<br />finds a buyer.</h2>
          <p>Failed COD deliveries sold to shoppers nearby, risky COD turned prepaid, abandoned carts recovered — on one screen.</p>
        </div>
        <svg className="route-mini" viewBox="0 0 900 380" aria-hidden="true" style={{ width: '100%', maxWidth: 520 }}>
          <path d="M40 330 C 200 330, 220 200, 360 190 S 540 140, 600 110" fill="none" stroke="#fff" strokeOpacity=".85" strokeWidth="10" strokeLinecap="round" />
          <path d="M600 110 C 560 220, 380 300, 200 330" fill="none" stroke="#5B6675" strokeWidth="5" strokeDasharray="2 16" strokeLinecap="round" />
          <path d="M600 110 C 650 60, 720 50, 800 40" fill="none" stroke="#C5F82A" strokeWidth="10" strokeLinecap="round" />
          <circle cx="600" cy="110" r="22" fill="#FF5B3A" />
          <circle cx="800" cy="40" r="26" fill="#C5F82A" /><circle cx="800" cy="40" r="9" fill="#0E1B2C" />
        </svg>
      </section>
      <section className="auth-form">{children}</section>
    </div>
  );
}

function useNext() {
  const next = new URLSearchParams(useLocation().search).get('next');
  return next && next.startsWith('/app') ? next : '/app';
}

export function Login() {
  const { setMe } = useSession();
  const nav = useNavigate();
  const next = useNext();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get('email') ?? '').trim();
    const password = String(f.get('password') ?? '');
    if (!email || !password) return setError('Enter your email and password.');
    setBusy(true);
    setError(null);
    try {
      setMe(await api.post<Me>('/auth/login', { email, password }));
      nav(next, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not log in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <form className="on-light" onSubmit={onSubmit} noValidate>
        <div>
          <h1>Log in</h1>
          <p style={{ color: 'var(--rr-slate)', marginTop: 8 }}>Welcome back. Let’s see what you rescued today.</p>
        </div>
        <div className="field"><label htmlFor="email">Email</label><input className="input" id="email" name="email" type="email" autoComplete="email" required /></div>
        <div className="field"><label htmlFor="password">Password</label><input className="input" id="password" name="password" type="password" autoComplete="current-password" required /></div>
        {error ? <p className="err" role="alert">{error}</p> : null}
        <button className="btn btn-ink" type="submit" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
        <p style={{ fontSize: 15 }}>New to ReRoute? <Link to={`/app/signup${next !== '/app' ? `?next=${encodeURIComponent(next)}` : ''}`}>Create an account</Link></p>
        {import.meta.env.DEV || location.hostname === 'localhost' ? (
          <div className="demo-box">Demo login (after <code>npm run seed:demo</code>):<br /><code>demo@reroute.example</code> / <code>Reroute-demo-2026</code></div>
        ) : null}
      </form>
    </AuthLayout>
  );
}

export function Signup() {
  const { setMe } = useSession();
  const nav = useNavigate();
  const next = useNext();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const name = String(f.get('name') ?? '').trim();
    const email = String(f.get('email') ?? '').trim();
    const password = String(f.get('password') ?? '');
    const acceptTerms = f.get('terms') === 'on';
    if (!name || !email) return setError('Add your name and email.');
    if (password.length < 10) return setError('Password must be at least 10 characters.');
    if (!acceptTerms) return setError('Please accept the terms to continue.');
    setBusy(true);
    setError(null);
    try {
      setMe(await api.post<Me>('/auth/signup', { name, email, password, acceptTerms }));
      nav(next === '/app' ? '/app/connect' : next, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create your account.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <form className="on-light" onSubmit={onSubmit} noValidate>
        <div>
          <h1>Create your account</h1>
          <p style={{ color: 'var(--rr-slate)', marginTop: 8 }}>Two minutes to connect your store. Your first rescued parcel could be tonight.</p>
        </div>
        <div className="field"><label htmlFor="name">Your name</label><input className="input" id="name" name="name" autoComplete="name" required /></div>
        <div className="field"><label htmlFor="email">Work email</label><input className="input" id="email" name="email" type="email" autoComplete="email" required /></div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input className="input" id="password" name="password" type="password" autoComplete="new-password" minLength={10} required aria-describedby="pw-hint" />
          <span className="hint" id="pw-hint">At least 10 characters, mixing letters with numbers or symbols.</span>
        </div>
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14.5 }}>
          <input type="checkbox" name="terms" style={{ marginTop: 3, width: 18, height: 18, accentColor: 'var(--rr-ink)' }} />
          <span>I agree to the <a href="/terms" target="_blank">terms</a> and <a href="/privacy" target="_blank">privacy policy</a>.</span>
        </label>
        {error ? <p className="err" role="alert">{error}</p> : null}
        <button className="btn btn-ink" type="submit" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
        <p style={{ fontSize: 15 }}>Already have an account? <Link to={`/app/login${next !== '/app' ? `?next=${encodeURIComponent(next)}` : ''}`}>Log in</Link></p>
      </form>
    </AuthLayout>
  );
}
