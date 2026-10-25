'use client';
import { Bars, Card, Page, RequestsTable, Stat, TeamDot } from '@/components/ui';
import { modelLabel, PII_LABEL, pct, providerLabel, TASK_LABEL, TEAM_COLORS, usd, useSummary } from '@/lib/api';

export default function Overview() {
  const s = useSummary();
  const t = s?.totals ?? {};
  const savedShare = t.baselineUsd ? t.savedUsd / t.baselineUsd : 0;
  const blocked = (t.blockedBudget ?? 0) + (t.blockedPii ?? 0) + (t.rateLimited ?? 0);

  return (
    <Page
      title="AI spend and savings"
      sub="This month, across every team and every AI provider."
      right={<span className="live">Live</span>}
    >
      <div className="stats" id="tiles">
        <Stat id="tile-spend" label="Spend this month" value={usd(t.spendUsd)} note="at sample prices" />
        <Stat id="tile-saved" label="Saved by routing and cache" value={usd(t.savedUsd)} note={`${pct(savedShare)} less than sending all to the default model`} tone="good" />
        <Stat id="tile-requests" label="Requests" value={String(t.requests ?? 0)} note={`${blocked} stopped by policy`} />
        <Stat id="tile-cache" label="Cache hit rate" value={pct(t.cacheHitRate ?? 0)} note={`${t.cacheHits ?? 0} answers from cache`} />
        <Stat id="tile-pii" label="Personal data removed" value={String(t.redactions ?? 0)} note="before leaving the company" />
        <Stat id="tile-fallback" label="Provider failovers" value={String(t.fallbacks ?? 0)} note={`${t.errors ?? 0} requests failed`} tone={t.errors ? 'bad' : undefined} />
      </div>

      <div className="grid cols-2" style={{ marginBottom: 16 }}>
        <Card title="Spend by team, against monthly budget" id="card-teams">
          {(s?.teams ?? []).map((team) => {
            const used = team.budgetUsd ? team.budgetUsedUsd / team.budgetUsd : 0;
            const tone = used >= 0.95 ? 'var(--bad)' : used >= 0.75 ? 'var(--warn)' : TEAM_COLORS[team.id];
            return (
              <div className="budget-row" key={team.id}>
                <div className="budget-top">
                  <span className="team">
                    <TeamDot team={team.id} />
                    {team.name}
                  </span>
                  <span className="mono">
                    <b>{usd(team.spendUsd)}</b> <span className="muted">of {usd(team.budgetUsd)} budget</span>
                  </span>
                </div>
                <div className="meter" title={`${pct(used)} of budget used`}>
                  <div style={{ width: `${Math.min(100, used * 100)}%`, background: tone }} />
                </div>
                <div className="small muted" style={{ marginTop: 5 }}>
                  {team.requests} requests · saved {usd(team.savedUsd)}
                  {team.blocked ? ` · ${team.blocked} stopped by policy` : ''}
                  {used >= 0.95 ? ' · budget reached' : ''}
                </div>
              </div>
            );
          })}
        </Card>

        <Card title="Spend by model" id="card-models">
          <Bars
            items={(s?.models ?? []).map((m) => ({
              key: m.model,
              label: (
                <span className="model">
                  <span className={`tier ${m.tier}`}>{m.tier === 'small' ? 'Small' : 'Large'}</span>
                  {modelLabel(m.model)}
                </span>
              ),
              value: m.spendUsd,
              color: m.tier === 'small' ? 'var(--series-3)' : 'var(--series-1)',
              sub: `${providerLabel(m.model)} · ${m.requests} requests`,
            }))}
          />
          <div className="legend" style={{ marginTop: 14 }}>
            <span><i className="swatch" style={{ background: 'var(--series-3)' }} /> Small model (cheap, fast)</span>
            <span><i className="swatch" style={{ background: 'var(--series-1)' }} /> Large model</span>
          </div>
        </Card>
      </div>

      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <Card title="Where the savings came from" id="card-savings">
          <Bars
            items={[
              { key: 'routing', label: 'Smart routing', value: t.savedRoutingUsd ?? 0, color: 'var(--good)' },
              { key: 'cache', label: 'Cache', value: t.savedCacheUsd ?? 0, color: 'var(--series-3)' },
            ]}
          />
          <p className="small muted" style={{ marginBottom: 0 }}>
            Compared with sending every request to each team&apos;s default model ({usd(t.baselineUsd)}).
          </p>
        </Card>
        <Card title="Jobs and how they were routed">
          <Bars
            format={(n) => String(n)}
            items={(s?.tasks ?? [])
              .sort((a, b) => b.requests - a.requests)
              .map((k) => ({ key: k.task, label: TASK_LABEL[k.task] ?? k.task, value: k.requests, color: 'var(--series-1)', sub: `${pct(k.small / Math.max(1, k.requests))} on the small model` }))}
          />
        </Card>
        <Card title="Personal data removed, by type">
          <Bars
            format={(n) => String(n)}
            items={Object.entries(s?.redactionsByType ?? {})
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => ({ key: k, label: PII_LABEL[k] ?? k, value: v, color: 'var(--series-2)' }))}
          />
          <p className="small muted" style={{ marginBottom: 0 }}>Counts only. The values themselves are never stored.</p>
        </Card>
      </div>

      <Card title="Latest requests" id="card-recent" right={<span className="small muted">No prompt text is stored or shown</span>}>
        <RequestsTable rows={(s?.recent ?? []).slice(0, 14)} />
      </Card>
      {s && <p className="small muted" style={{ marginTop: 14 }}>{s.priceLabel}</p>}
    </Page>
  );
}
