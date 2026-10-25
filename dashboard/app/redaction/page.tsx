'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { Card, Page } from '@/components/ui';
import { api, PII_LABEL } from '@/lib/api';

const SAMPLE = `Hi team, please summarise this complaint and draft a reply.

Customer: Jane Doe, email jane.doe@example.com, phone 07700 900123.
She paid with card 4111 1111 1111 1111 and wants the refund to IBAN GB82 WEST 1234 5698 7654 32.
NI number AB 12 34 56 C, postcode SW1A 1AA.`;

type Preview = { redacted: string; findings: Array<{ type: string; token: string; start: number; end: number }>; spans: Array<{ type: string; start: number; end: number }>; counts: Record<string, number> };

function mark(text: string, spans: Array<{ start: number; end: number; type: string }>, cls: string): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  spans.forEach((s, i) => {
    out.push(text.slice(at, s.start));
    out.push(<span key={i} className={cls} title={PII_LABEL[s.type]}>{text.slice(s.start, s.end)}</span>);
    at = s.end;
  });
  out.push(text.slice(at));
  return out;
}

export default function Redaction() {
  const [text, setText] = useState(SAMPLE);
  const [p, setP] = useState<Preview | null>(null);
  useEffect(() => {
    const t = setTimeout(async () => setP(await api<Preview>('admin/redact-preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })), 150);
    return () => clearTimeout(t);
  }, [text]);

  return (
    <Page title="Personal data protection" sub="Emails, phone numbers, card numbers, IBANs, NI numbers and postcodes are swapped for tokens before a request leaves. The real values are put back into the answer. This preview is not stored or logged.">
      <div className="grid cols-2" style={{ marginBottom: 16 }}>
        <Card title="What your app sent" id="original">
          <div className="textview">{p ? mark(text, p.spans, 'pii') : text}</div>
        </Card>
        <Card title="What the AI provider received" id="redacted">
          <div className="textview">{p ? mark(p.redacted, p.findings, 'token') : ''}</div>
        </Card>
      </div>
      <div className="grid cols-2">
        <Card title="Try your own text">
          <textarea id="pii-input" rows={6} value={text} onChange={(e) => setText(e.target.value)} />
        </Card>
        <Card title="Found in this text">
          <dl className="kv" id="pii-counts">
            {Object.entries(p?.counts ?? {}).map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt>{PII_LABEL[k]}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <p className="small muted">Card numbers are checked with the Luhn checksum and IBANs with the bank checksum, so order numbers and dates are left alone. Names and free text addresses need an optional extra model and are not caught by this build.</p>
        </Card>
      </div>
    </Page>
  );
}
