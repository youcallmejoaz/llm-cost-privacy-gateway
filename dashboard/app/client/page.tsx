'use client';
import { useRef, useState } from 'react';
import { Card, Page, Stat, StatusBadge, TeamName } from '@/components/ui';
import { modelLabel, providerLabel, TASK_LABEL, TEAM_KEYS, time, usd, useSummary } from '@/lib/api';

const PRESETS = [
  {
    id: 'classify',
    team: 'support',
    label: 'Support: classify a ticket',
    text: 'Classify this support ticket into one category (billing, delivery, account_access, product_question, refund_request), with urgency and sentiment.\n\nTicket: I was charged twice for order ORD-48213 (49.99 GBP) and want one payment refunded. You can email me at jane.doe@example.com.',
  },
  {
    id: 'summary',
    team: 'support',
    label: 'Support: summarise a call',
    text: "Summarise this call transcript in one paragraph with a next step.\n\nCustomer: Hi, it's jane.doe@example.com, my number is 07700 900123. I was charged twice on card 4111 1111 1111 1111 for order ORD-48213.\nAgent: Sorry about that, let me check the payments.",
  },
  {
    id: 'newsletter',
    team: 'marketing',
    label: 'Marketing: write a newsletter',
    text: 'Write an email newsletter for existing customers announcing our December offer on the annual plan: two extra months free. Friendly tone, 150 words, clear call to action.',
  },
  {
    id: 'analysis',
    team: 'data',
    label: 'Data: analyse churn',
    text: "Analyse this quarter's churn data. Identify the segments driving churn, likely causes, and give recommendations.\n\nmonth,segment,plan,accounts,churned\n2026-07,smb,monthly,1840,61\n2026-08,smb,monthly,1902,74\n2026-09,smb,monthly,1955,92\n2026-09,mid,annual,640,7",
  },
];

type Reply = { status: number; body: any; headers: Record<string, string> };

export default function ClientApp() {
  const [team, setTeam] = useState('support');
  const [text, setText] = useState(PRESETS[0].text);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<Reply | null>(null);
  const [burst, setBurst] = useState<{ sent: number; total: number; ok: number } | null>(null);
  const stop = useRef(false);
  const s = useSummary(700);

  async function send(teamId: string, body: object): Promise<Reply> {
    const res = await fetch('/api/gw/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TEAM_KEYS[teamId]}` },
      body: JSON.stringify(body),
    });
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k] = v));
    return { status: res.status, body: await res.json(), headers };
  }

  async function sendOne() {
    setBusy(true);
    setReply(null);
    try {
      setReply(await send(team, { model: 'auto', max_tokens: 600, messages: [{ role: 'user', content: text }] }));
    } finally {
      setBusy(false);
    }
  }

  async function sendBurst() {
    const samples: Array<{ team: string; body: object }> = await (await fetch('/api/samples')).json();
    stop.current = false;
    let sent = 0;
    let ok = 0;
    setBurst({ sent, total: samples.length, ok });
    let next = 0;
    const worker = async () => {
      while (next < samples.length && !stop.current) {
        const smp = samples[next++];
        const r = await send(smp.team, smp.body);
        sent++;
        if (r.status === 200) ok++;
        setBurst({ sent, total: samples.length, ok });
      }
    };
    await Promise.all(Array.from({ length: 5 }, worker));
  }

  const g = reply?.body?.gateway ?? {};
  const t = s?.totals ?? {};
  const err = reply && reply.status !== 200 ? reply.body?.error : null;

  return (
    <Page title="Demo client app" sub="A stand-in for your company's apps. It talks to the gateway exactly like it would talk to OpenAI: same request format, only the base URL changes.">
      <div className="grid split">
        <div className="grid">
          <Card title="Ask the AI" id="ask">
            <div className="row" style={{ marginBottom: 12 }}>
              <label className="field">
                Team
                <select id="team" value={team} onChange={(e) => setTeam(e.target.value)}>
                  <option value="support">Support</option>
                  <option value="marketing">Marketing</option>
                  <option value="data">Data</option>
                </select>
              </label>
              <label className="field" style={{ flex: 1 }}>
                Example
                <select
                  id="preset"
                  onChange={(e) => {
                    const p = PRESETS.find((x) => x.id === e.target.value)!;
                    setTeam(p.team);
                    setText(p.text);
                  }}
                >
                  {PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <textarea id="prompt" rows={7} value={text} onChange={(e) => setText(e.target.value)} />
            <div className="row" style={{ marginTop: 12 }}>
              <button id="send" className="btn primary" onClick={sendOne} disabled={busy}>
                {busy ? 'Sending...' : 'Send request'}
              </button>
              <button id="burst" className="btn" onClick={sendBurst} disabled={!!burst && burst.sent < burst.total}>
                Send sample traffic (200 requests)
              </button>
              {burst && (
                <span className="small muted" id="burst-progress">
                  {burst.sent} of {burst.total} sent · {burst.ok} answered
                </span>
              )}
            </div>
          </Card>

          {reply && reply.status === 200 && (
            <Card title="Answer" id="answer">
              <div className="reply">{reply.body.choices?.[0]?.message?.content}</div>
              <div className="meta">
                <span className="chip">Model <b>{modelLabel(g.model)}</b> ({providerLabel(g.model)})</span>
                <span className="chip">Job <b>{TASK_LABEL[g.task] ?? g.task}</b></span>
                <span className="chip" id="chip-cache">Cache <b>{g.cache === 'exact' || g.cache === 'semantic' ? 'hit' : 'miss'}</b></span>
                <span className="chip" id="chip-cost">Cost <b>{usd(g.costUsd)}</b></span>
                <span className="chip">Saved <b className="save">{usd(g.savedUsd)}</b></span>
                <span className="chip">Personal data removed <b>{g.redactions}</b></span>
                {g.fallback && <span className="badge warn">Answered by backup provider</span>}
              </div>
            </Card>
          )}

          {err && (
            <div className={`notice ${reply!.status === 429 || reply!.status === 422 ? 'warn' : 'bad'}`} id="error">
              <div className="notice-title">
                {err.type === 'budget_exceeded' ? 'Monthly AI budget reached' : err.type === 'pii_blocked' ? 'Not sent: personal data policy' : err.type === 'rate_limited' ? 'Slow down a little' : 'Something went wrong'}
              </div>
              {err.message}
            </div>
          )}
        </div>

        <div className="grid">
          <Card title="Gateway, live" right={<span className="live">Live</span>} id="live">
            <div className="stats four" style={{ marginBottom: 0 }}>
              <Stat label="Requests" value={String(t.requests ?? 0)} />
              <Stat label="Spend" value={usd(t.spendUsd)} />
              <Stat label="Saved" value={usd(t.savedUsd)} tone="good" />
              <Stat label="Personal data removed" value={String(t.redactions ?? 0)} />
            </div>
          </Card>
          <Card title="What just happened">
            <div className="feed" id="feed">
              {(s?.recent ?? []).slice(0, 9).map((r) => (
                <div className="feed-item" key={r.id}>
                  <span className="mono muted">{time(r.ts)}</span>
                  <TeamName team={r.teamId} />
                  <span>
                    {TASK_LABEL[r.task]} {r.routedModel ? <>to <b>{modelLabel(r.routedModel)}</b></> : ''}
                    {r.fallbackUsed ? ' (backup)' : ''}
                    {r.cache === 'exact' ? ' from cache' : ''}
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
