import type { ReactNode } from 'react';

export const money = (v: number | null | undefined, cents = true) =>
  v == null ? '—' : `$${Math.round(cents ? v / 100 : v).toLocaleString('en-US')}`;
// Date-only values (YYYY-MM-DD) are calendar dates: format them in UTC so they never shift a day.
export const day = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric',
        timeZone: /^\d{4}-\d{2}-\d{2}$/.test(v) ? 'UTC' : undefined }) : '—';
export const dayTime = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';

const TONE: Record<string, string> = {
  on_track: 'green', achieved: 'green', healthy: 'green', active: 'green', done: 'green', won: 'green', completed: 'green', approved: 'green',
  at_risk: 'amber', watch: 'amber', onboarding: 'amber', in_progress: 'amber', pending: 'amber', paused: 'amber', open: 'amber', medium: 'amber', submitted: 'amber',
  off_track: 'red', critical: 'red', suspended: 'red', blocked: 'red', lost: 'red', overdue: 'red', high: 'red', urgent: 'red', revoked: 'red',
};
export function Pill({ value, label }: { value: string | null | undefined; label?: string }) {
  const v = value ?? 'none';
  return <span className={`pill ${TONE[v] ?? 'gray'}`}>{label ?? v.replace(/_/g, ' ')}</span>;
}

export function Stat({ k, v, s }: { k: string; v: ReactNode; s?: ReactNode }) {
  return <div className="card stat"><div className="k">{k}</div><div className="v">{v}</div>{s && <div className="s">{s}</div>}</div>;
}

export function PageHead({ sub, title, children }: { sub?: string; title: string; children?: ReactNode }) {
  return (
    <div className="head">
      <div>{sub && <div className="sub">{sub}</div>}<h1>{title}</h1></div>
      <div className="row">{children}</div>
    </div>
  );
}

export function Flash({ msg, err }: { msg?: string; err?: string }) {
  if (err) return <div className="flash err" role="alert">{err}</div>;
  if (msg) return <div className="flash" role="status">{msg}</div>;
  return null;
}

export function Bar({ pct }: { pct: number }) {
  return <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></div>;
}

export type SP = Promise<{ msg?: string; err?: string }>;
