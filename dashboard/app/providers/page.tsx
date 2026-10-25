'use client';
import { useEffect, useRef, useState } from 'react';
import { Card, Page, Stat, StatusBadge, TeamName } from '@/components/ui';
import { api, modelLabel, sendChat, time, useSummary } from '@/lib/api';

const NAMES: Record<string, string> = { anthropic: 'Anthropic (Claude)', openai: 'OpenAI', google: 'Google (Gemini)' };

function Timeline({ buckets, max }: { buckets: Array<{ t: number; ok: number; bad: number }>; max: number }) {
  return (
    <div className="timeline" style={{ height: 70 }}>
      {buckets.map((b) => (
        <div className="col" key={b.t} title={`${time(new Date(b.t).toISOString())}: ${b.ok} ok, ${b.bad} failed`}>
          {b.ok > 0 && <div className="seg" style={{ height: `${(b.ok / max) * 66}px`, background: 'var(--series-1)' }} />}
          {b.bad > 0 && <div className="seg" style={{ height: `${(b.bad / max) * 66}px`, background: 'var(--bad)' }} />}
        </div>
      ))}
    </div>
  );
}

export default function Providers() {
  const s = useSummary(700);
  const [traffic, setTraffic] = useState(false);
  const running = useRef(false);
  const samples = useRef<Array<{ team: string; body: object }>>([]);

  useEffect(() => {
    running.current = traffic;
    if (!traffic) return;
    let i = 0;
    const loop = async () => {
      if (!samples.current.length) samples.current = (await (await fetch('/api/samples')).json()).filter((x: { team: string }) => x.team !== 'marketing');
      while (running.current) {
        const smp = samples.current[i++ % samples.current.length];
        await sendChat(smp.team, smp.body, { 'x-gateway-cache': 'off' });
        await new Promise((r) => setTimeout(r, 120));
      }
    };
    loop();
    loop();
  }, [traffic]);

  const now = Date.now();
  const slots = Array.from({ length: 24 }, (_, k) => Math.floor((now - (23 - k) * 5000) / 5000) * 5000);
  const providers = s?.providers ?? [];
  const max = Math.max(4, ...providers.flatMap((p) => p.timeline.map(([, ok, bad]) => ok + bad)));
  const appView = s?.timeline.slice(-12) ?? [];
  const appOk = appView.reduce((a, b) => a + b.ok, 0);
  const appErr = appView.reduce((a, b) => a + b.errors, 0);
  const appFb = appView.reduce((a, b) => a + b.fallbacks, 0);

  const setFault = async (id: string, mode: string) => api(`admin/providers/${id}/fault`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode }) });

  return (
    <Page
      title="Providers"
      sub="Each AI provider's health, and what your apps experience when one goes down."
      right={
        <button id="traffic" className={`btn ${traffic ? '' : 'primary'}`} onClick={() => setTraffic(!traffic)}>
          {traffic ? 'Stop live traffic' : 'Start live traffic'}
        </button>
      }
    >
      <div className="grid split">
        <div className="prov">
          {providers.map((p) => {
            const tl = new Map(p.timeline.map(([t, ok, bad]) => [t, { ok, bad }]));
            const down = p.fault !== 'none' || p.circuitOpen;
            return (
              <div className={`prov-card ${down ? 'down' : ''}`} key={p.id} id={`prov-${p.id}`}>
                <div className="prov-top">
                  <div>
                    <div className="prov-name">{NAMES[p.id]}</div>
                    <div className="small muted">
                      {p.mock ? 'Demo mode: simulated provider' : p.configured ? 'Live API key configured' : 'Not configured'} · {p.ok} ok · {p.errors} failed
                    </div>
                  </div>
                  <div className="row">
                    {p.fault !== 'none' ? <span className="badge bad">✕ Outage (simulated)</span> : p.circuitOpen ? <span className="badge warn">! Paused after errors</span> : <span className="badge good">✓ Healthy</span>}
                    {p.mock && (
                      <button className={`btn ${p.fault === 'none' ? 'danger' : ''}`} id={`fault-${p.id}`} onClick={() => setFault(p.id, p.fault === 'none' ? 'error' : 'none')}>
                        {p.fault === 'none' ? 'Simulate outage' : 'Restore'}
                      </button>
                    )}
                  </div>
                </div>
                <div style={{ marginTop: 12 }}>
                  <Timeline max={max} buckets={slots.map((t) => ({ t, ...(tl.get(t) ?? { ok: 0, bad: 0 }) }))} />
                </div>
              </div>
            );
          })}
          <div className="legend">
            <span><i className="swatch" style={{ background: 'var(--series-1)' }} /> Successful calls</span>
            <span><i className="swatch" style={{ background: 'var(--bad)' }} /> Failed calls</span>
            <span>Last 2 minutes, 5 second steps</span>
          </div>
        </div>

        <div className="grid">
          <Card title="What your apps saw, last minute" id="apps">
            <div className="stats four" style={{ marginBottom: 0 }}>
              <Stat label="Answered" value={String(appOk)} tone="good" />
              <Stat label="Failed" value={String(appErr)} tone={appErr ? 'bad' : undefined} />
              <Stat label="Answered by backup provider" value={String(appFb)} tone={appFb ? 'warn' : undefined} />
              <Stat label="Success rate" value={appOk + appErr ? `${Math.round((appOk / (appOk + appErr)) * 100)}%` : '-'} />
            </div>
          </Card>
          <Card title="Latest requests">
            <div className="feed">
              {(s?.recent ?? []).slice(0, 8).map((r) => (
                <div className="feed-item" key={r.id}>
                  <span className="mono muted">{time(r.ts)}</span>
                  <TeamName team={r.teamId} />
                  <span>
                    {r.fallbackUsed ? <b>backup: </b> : null}
                    {modelLabel(r.routedModel)}
                  </span>
                  <StatusBadge status={r.status} />
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </Page>
  );
}
