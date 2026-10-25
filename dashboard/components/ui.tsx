'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { modelLabel, PII_LABEL, providerLabel, TASK_LABEL, TEAM_COLORS, time, usd, type Row } from '@/lib/api';

const NAV = [
  ['/', 'Overview'],
  ['/client', 'Demo client app'],
  ['/redaction', 'Personal data'],
  ['/providers', 'Providers'],
  ['/audit', 'Audit log'],
  ['/routing', 'Rules and prices'],
] as const;

export function Nav() {
  const path = usePathname();
  return (
    <nav className="nav">
      <div className="brand">
        <span className="logo" aria-hidden>
          <svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 7h16M4 12h10M4 17h16" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" fill="none" /></svg>
        </span>
        <div>
          <div className="brand-name">AI Gateway</div>
          <div className="brand-sub">Cost and privacy control</div>
        </div>
      </div>
      {NAV.map(([href, label]) => (
        <Link key={href} href={href} className={`nav-link ${path === href ? 'active' : ''}`}>
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function Page({ title, sub, children, right }: { title: string; sub?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <main className="page">
      <header className="page-head">
        <div>
          <h1>{title}</h1>
          {sub && <p className="sub">{sub}</p>}
        </div>
        {right}
      </header>
      {children}
    </main>
  );
}

export function Card({ title, children, className = '', right, id }: { title?: string; children: ReactNode; className?: string; right?: ReactNode; id?: string }) {
  return (
    <section className={`card ${className}`} id={id}>
      {title && (
        <div className="card-head">
          <h2>{title}</h2>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, note, tone, id }: { label: string; value: string; note?: string; tone?: 'good' | 'warn' | 'bad'; id?: string }) {
  return (
    <div className={`stat ${tone ?? ''}`} id={id}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  );
}

export function TeamDot({ team }: { team: string }) {
  return <span className="dot" style={{ background: TEAM_COLORS[team] ?? 'var(--muted)' }} />;
}

export function TeamName({ team }: { team: string }) {
  return (
    <span className="team">
      <TeamDot team={team} />
      {team[0].toUpperCase() + team.slice(1)}
    </span>
  );
}

const STATUS: Record<string, [string, string]> = {
  ok: ['OK', 'good'],
  blocked_budget: ['Budget limit', 'warn'],
  blocked_pii: ['Blocked: personal data', 'warn'],
  rate_limited: ['Rate limited', 'warn'],
  forbidden_model: ['Model not allowed', 'warn'],
  error: ['Error', 'bad'],
};

export function StatusBadge({ status }: { status: string }) {
  const [label, tone] = STATUS[status] ?? [status, 'warn'];
  const icon = tone === 'good' ? '✓' : tone === 'bad' ? '✕' : '!';
  return (
    <span className={`badge ${tone}`}>
      <span aria-hidden>{icon}</span> {label}
    </span>
  );
}

export function TierBadge({ model, small }: { model: string | null; small: boolean }) {
  if (!model) return <span className="muted">-</span>;
  return (
    <span className="model">
      <span className={`tier ${small ? 'small' : 'large'}`}>{small ? 'Small' : 'Large'}</span>
      <span>{modelLabel(model)}</span>
      <span className="muted"> {providerLabel(model)}</span>
    </span>
  );
}

const SMALL = /haiku|mini|flash/;

export function RequestsTable({ rows, showRule = true, highlightId }: { rows: Row[]; showRule?: boolean; highlightId?: string }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Team</th>
            <th>Job</th>
            <th>Routed to</th>
            {showRule && <th>Why</th>}
            <th>Cache</th>
            <th className="num">Cost</th>
            <th className="num">Saved</th>
            <th className="num">Personal data removed</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const pii = Object.values(r.redactions).reduce((a, b) => a + b, 0);
            return (
              <tr key={r.id} data-id={r.id} className={r.id === highlightId ? 'hl' : ''}>
                <td className="mono muted">{time(r.ts)}</td>
                <td><TeamName team={r.teamId} /></td>
                <td>{TASK_LABEL[r.task] ?? r.task}</td>
                <td>
                  <TierBadge model={r.routedModel} small={SMALL.test(r.routedModel ?? '')} />
                  {r.fallbackUsed && <span className="badge warn tiny">fallback</span>}
                </td>
                {showRule && <td className="muted small">{r.routeRule || '-'}</td>}
                <td>{r.cache === 'exact' || r.cache === 'semantic' ? <span className="badge good">Hit</span> : <span className="muted">{r.cache === 'miss' ? 'Miss' : '-'}</span>}</td>
                <td className="num mono">{usd(r.costUsd)}</td>
                <td className={`num mono ${r.savedUsd > 0 ? 'save' : 'muted'}`}>{r.savedUsd > 0 ? usd(r.savedUsd) : '-'}</td>
                <td className="num">{pii ? <span title={Object.entries(r.redactions).map(([k, v]) => `${PII_LABEL[k]}: ${v}`).join(', ')}>{pii}</span> : <span className="muted">0</span>}</td>
                <td><StatusBadge status={r.status} /></td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={10} className="empty">No requests yet. Open the demo client app and send some.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Horizontal bars: one per item, value labelled, colour given per item. */
export function Bars({ items, format = usd }: { items: Array<{ key: string; label: ReactNode; value: number; color?: string; sub?: string }>; format?: (n: number) => string }) {
  const max = Math.max(...items.map((i) => i.value), 1e-9);
  return (
    <div className="bars">
      {items.map((i) => (
        <div className="bar-row" key={i.key} title={`${typeof i.label === 'string' ? i.label : i.key}: ${format(i.value)}`}>
          <div className="bar-label">{i.label}</div>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${Math.max(1, (i.value / max) * 100)}%`, background: i.color ?? 'var(--series-1)' }} />
          </div>
          <div className="bar-value mono">{format(i.value)}</div>
          {i.sub && <div className="bar-sub">{i.sub}</div>}
        </div>
      ))}
    </div>
  );
}
