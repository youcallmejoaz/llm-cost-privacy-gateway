import type { PiiType } from '../types.js';
import { DETECTORS } from './detectors.js';

const TOKEN_LABEL: Record<PiiType, string> = {
  email: 'EMAIL',
  phone: 'PHONE',
  ni_number: 'NI_NUMBER',
  card: 'CARD',
  iban: 'IBAN',
  postcode: 'POSTCODE',
};

export interface Finding {
  type: PiiType;
  token: string;
  start: number;
  end: number;
}

interface Span {
  type: PiiType;
  start: number;
  end: number;
  value: string;
}

export function findPii(text: string): Span[] {
  const spans: Span[] = [];
  for (const det of DETECTORS) {
    det.pattern.lastIndex = 0;
    for (const m of text.matchAll(det.pattern)) {
      const value = m[0];
      const start = m.index ?? 0;
      const end = start + value.length;
      if (det.validate && !det.validate(value)) continue;
      if (spans.some((s) => start < s.end && end > s.start)) continue;
      spans.push({ type: det.type, start, end, value });
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

/**
 * One Redactor per request. The same value always maps to the same token,
 * so "[EMAIL_1]" means the same address everywhere in the conversation.
 * The token map lives only in memory for the life of the request.
 */
export class Redactor {
  private valueToToken = new Map<string, string>();
  private tokenToValue = new Map<string, string>();
  private counters: Partial<Record<PiiType, number>> = {};
  readonly counts: Partial<Record<PiiType, number>> = {};

  redact(text: string): { text: string; findings: Finding[] } {
    const spans = findPii(text);
    if (spans.length === 0) return { text, findings: [] };
    let out = '';
    let cursor = 0;
    const findings: Finding[] = [];
    for (const s of spans) {
      const token = this.tokenFor(s.type, s.value);
      out += text.slice(cursor, s.start);
      findings.push({ type: s.type, token, start: out.length, end: out.length + token.length });
      out += token;
      cursor = s.end;
      this.counts[s.type] = (this.counts[s.type] ?? 0) + 1;
    }
    out += text.slice(cursor);
    return { text: out, findings };
  }

  /** Put the original values back into the provider's reply. */
  restore(text: string): string {
    if (this.tokenToValue.size === 0) return text;
    return text.replace(/\[([A-Z_]+_\d+)\]/g, (whole, inner: string) => this.tokenToValue.get(`[${inner}]`) ?? whole);
  }

  get total(): number {
    return Object.values(this.counts).reduce((a, b) => a + (b ?? 0), 0);
  }

  typesFound(): PiiType[] {
    return Object.keys(this.counts) as PiiType[];
  }

  private tokenFor(type: PiiType, value: string): string {
    const key = `${type}\u0000${normalise(type, value)}`;
    const existing = this.valueToToken.get(key);
    if (existing) return existing;
    const n = (this.counters[type] = (this.counters[type] ?? 0) + 1);
    const token = `[${TOKEN_LABEL[type]}_${n}]`;
    this.valueToToken.set(key, token);
    this.tokenToValue.set(token, value);
    return token;
  }
}

function normalise(type: PiiType, value: string): string {
  if (type === 'email') return value.toLowerCase();
  if (type === 'card' || type === 'phone') return value.replace(/\D/g, '');
  return value.replace(/\s+/g, '').toUpperCase();
}
