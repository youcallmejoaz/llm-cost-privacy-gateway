'use client';
import { Card, Page } from '@/components/ui';
import { modelLabel, providerLabel, usePoll } from '@/lib/api';

type Cfg = {
  prices: { _label: string; models: Record<string, { input: number; output: number }> };
  tiers: { small: string[]; large: string[] };
  routing: { classifier: string; rules: Array<{ name: string; when: Record<string, unknown>; route: string }>; default: string };
  teams: Array<{ id: string; name: string; monthlyBudgetUsd: number; rpmLimit: number; defaultModel: string; pii: { mode: string; blockTypes: string[] } }>;
  stores: { cache: string; ledger: string };
};

function when(w: Record<string, unknown>): string {
  const parts: string[] = [];
  if (w.team) parts.push(`team is ${[w.team].flat().join(' or ')}`);
  if (w.task) parts.push(`job is ${(w.task as string[]).join(' or ')}`);
  if (w.minInputTokens) parts.push(`input over ${w.minInputTokens} tokens`);
  if (w.maxInputTokens) parts.push(`input up to ${w.maxInputTokens} tokens`);
  if (w.contains) parts.push(`mentions ${(w.contains as string[]).join(', ')}`);
  return parts.join(' and ') || 'always';
}

export default function Routing() {
  const c = usePoll<Cfg>('admin/config', 2000);
  return (
    <Page title="Rules and prices" sub="Routing rules, budgets and prices are plain data in the config folder. Edit a file and the gateway picks it up without a restart.">
      <div className="grid cols-2" style={{ marginBottom: 16 }}>
        <Card title="Routing rules (first match wins)" id="rules">
          <table className="table">
            <thead><tr><th>#</th><th>Rule</th><th>When</th><th>Send to</th></tr></thead>
            <tbody>
              {c?.routing.rules.map((r, i) => (
                <tr key={r.name}><td className="muted">{i + 1}</td><td className="mono small">{r.name}</td><td>{when(r.when)}</td><td><b>{r.route}</b></td></tr>
              ))}
              <tr><td className="muted">-</td><td className="mono small">default</td><td>nothing else matched</td><td><b>{c?.routing.default}</b></td></tr>
            </tbody>
          </table>
          <p className="small muted">Small chain: {c?.tiers.small.map(modelLabel).join(' → ')}. Large chain: {c?.tiers.large.map(modelLabel).join(' → ')}. If the first is down, the next one answers.</p>
        </Card>
        <Card title="Teams">
          <table className="table">
            <thead><tr><th>Team</th><th className="num">Monthly budget</th><th className="num">Per minute</th><th>Default model</th><th>Personal data</th></tr></thead>
            <tbody>
              {c?.teams.map((t) => (
                <tr key={t.id}><td><b>{t.name}</b></td><td className="num mono">${t.monthlyBudgetUsd.toFixed(2)}</td><td className="num">{t.rpmLimit}</td><td>{modelLabel(t.defaultModel)}</td><td>{t.pii.mode}{t.pii.blockTypes.length ? `, block ${t.pii.blockTypes.join(', ')}` : ''}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="small muted">Demo budgets are sized to the 200 sample requests. Storage: cache in {c?.stores.cache}, ledger in {c?.stores.ledger}.</p>
        </Card>
      </div>
      <Card title="Price table (USD per million tokens)">
        <div className="price-note">{c?.prices._label}</div>
        <table className="table">
          <thead><tr><th>Model</th><th>Provider</th><th className="num">Input</th><th className="num">Output</th></tr></thead>
          <tbody>
            {Object.entries(c?.prices.models ?? {}).map(([m, p]) => (
              <tr key={m}><td>{modelLabel(m)}</td><td>{providerLabel(m)}</td><td className="num mono">${p.input.toFixed(2)}</td><td className="num mono">${p.output.toFixed(2)}</td></tr>
            ))}
          </tbody>
        </table>
      </Card>
    </Page>
  );
}
