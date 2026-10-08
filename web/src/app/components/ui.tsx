import type { ReactNode } from 'react';
import type { CaseStatus, RiskAction } from '../api';

export function Kpi({ label, value, sub, hero }: { label: string; value: ReactNode; sub?: ReactNode; hero?: boolean }) {
  return (
    <div className={`card kpi${hero ? ' hero' : ''}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
}

export function Skeleton({ h = 18, w = '100%' }: { h?: number; w?: number | string }) {
  return <div className="skeleton" style={{ height: h, width: w }} aria-hidden="true" />;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="banner bad" role="alert">
      <span>{message}</span>
      {onRetry ? <button className="btn btn-ink btn-sm" onClick={onRetry}>Try again</button> : null}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {action ? <div style={{ marginTop: 18 }}>{action}</div> : null}
    </div>
  );
}

const CASE: Record<CaseStatus, [string, string]> = {
  completed: ['Rescued', 'lime'],
  offered: ['Offers live', 'ink'],
  claimed: ['Paid · redirecting', 'ink'],
  evaluating: ['Checking', 'grey'],
  expired: ['No buyer in time', 'grey'],
  no_match: ['No buyer nearby', 'grey'],
  ineligible: ['Not eligible', 'outline'],
  failed: ['Failed · refunded', 'coral'],
};
export function CasePill({ status }: { status: CaseStatus }) {
  const [label, tone] = CASE[status];
  return <span className={`pill ${tone}`}>{label}</span>;
}

const RISK: Record<RiskAction, [string, string]> = {
  allow: ['Low risk', 'grey'],
  nudge_prepaid: ['Prepaid nudge', 'amber'],
  partial_cod: ['Partial COD', 'coral'],
  verify: ['Verify phone', 'coral'],
  block_cod: ['COD blocked', 'coral'],
};
export function RiskPill({ action }: { action: RiskAction | null }) {
  if (!action) return <span className="pill outline">Prepaid</span>;
  const [label, tone] = RISK[action];
  return <span className={`pill ${tone}`}>{label}</span>;
}

export function RiskMeter({ score }: { score: number | null }) {
  if (score == null) return <span style={{ color: 'var(--rr-slate)' }}>—</span>;
  const color = score >= 75 ? 'var(--rr-coral)' : score >= 45 ? '#E9A23B' : '#7FA81A';
  return (
    <span className="risk" title={`Risk score ${score} out of 100`}>
      <b>{score}</b>
      <span className="risk-bar"><i style={{ width: `${score}%`, background: color }} /></span>
    </span>
  );
}
