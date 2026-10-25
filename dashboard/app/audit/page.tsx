'use client';
import { useState } from 'react';
import { Card, Page, RequestsTable } from '@/components/ui';
import { usePoll, type Row } from '@/lib/api';

export default function Audit() {
  const [team, setTeam] = useState('');
  const [status, setStatus] = useState('');
  const data = usePoll<{ rows: Row[] }>(`admin/requests?limit=60&team=${team}&status=${status}`, 1500);
  return (
    <Page title="Audit log" sub="Every request with team, model, tokens, cost and policy decisions. Prompt and answer text are never stored, so they cannot leak from here.">
      <Card
        title={`${data?.rows.length ?? 0} most recent requests`}
        right={
          <div className="row">
            <select id="audit-team" value={team} onChange={(e) => setTeam(e.target.value)}>
              <option value="">All teams</option>
              <option value="support">Support</option>
              <option value="marketing">Marketing</option>
              <option value="data">Data</option>
            </select>
            <select id="audit-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All results</option>
              <option value="ok">OK</option>
              <option value="blocked_budget">Budget limit</option>
              <option value="blocked_pii">Blocked: personal data</option>
              <option value="error">Error</option>
            </select>
          </div>
        }
      >
        <RequestsTable rows={data?.rows ?? []} />
        <details style={{ marginTop: 14 }}>
          <summary className="small muted">What one audit record holds</summary>
          <pre className="small" style={{ whiteSpace: 'pre-wrap' }}>{data?.rows[0] ? JSON.stringify(data.rows[0], null, 2) : ''}</pre>
        </details>
      </Card>
    </Page>
  );
}
