'use client';
import { useEffect, useState } from 'react';

export const TEAM_COLORS: Record<string, string> = { support: 'var(--series-1)', marketing: 'var(--series-2)', data: 'var(--series-3)' };
export const TEAM_KEYS: Record<string, string> = { support: 'demo-key-support', marketing: 'demo-key-marketing', data: 'demo-key-data' };

export interface Row {
  id: string;
  ts: string;
  teamId: string;
  requestedModel: string;
  routedModel: string | null;
  routeRule: string;
  task: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  baselineModel: string;
  baselineCostUsd: number;
  savedUsd: number;
  cache: string;
  redactions: Record<string, number>;
  policy: string[];
  status: string;
  httpStatus: number;
  attempts: Array<{ model: string; outcome: string; ms: number; error?: string }>;
  fallbackUsed: boolean;
  latencyMs: number;
}

export interface Summary {
  demoMode: boolean;
  priceLabel: string;
  totals: Record<string, number>;
  redactionsByType: Record<string, number>;
  teams: Array<{ id: string; name: string; budgetUsd: number; budgetUsedUsd: number; requests: number; spendUsd: number; savedUsd: number; blocked: number }>;
  models: Array<{ model: string; requests: number; spendUsd: number; tokens: number; tier: string }>;
  tasks: Array<{ task: string; requests: number; spendUsd: number; small: number }>;
  timeline: Array<{ t: number; ok: number; errors: number; fallbacks: number; blocked: number }>;
  providers: Array<{ id: string; configured: boolean; mock: boolean; fault: string; ok: number; errors: number; circuitOpen: boolean; timeline: Array<[number, number, number]> }>;
  recent: Row[];
}

export async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/gw/${path}`, { cache: 'no-store', ...init });
  return res.json();
}

export function usePoll<T>(path: string | null, ms = 1000): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    const tick = async () => {
      try {
        const d = await api<T>(path);
        if (alive) setData(d);
      } catch {}
    };
    tick();
    const t = setInterval(tick, ms);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [path, ms]);
  return data;
}

export const useSummary = (ms = 1000) => usePoll<Summary>('admin/summary', ms);

export function usd(n: number | undefined): string {
  if (n === undefined || Number.isNaN(n)) return '$0';
  if (Math.abs(n) >= 100) return `$${n.toFixed(0)}`;
  if (Math.abs(n) >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function modelLabel(m: string | null): string {
  if (!m) return '-';
  return m.split(':')[1] ?? m;
}

export function providerLabel(m: string | null): string {
  const p = m?.split(':')[0];
  return p === 'anthropic' ? 'Anthropic' : p === 'openai' ? 'OpenAI' : p === 'google' ? 'Google' : '-';
}

export const TASK_LABEL: Record<string, string> = {
  classification: 'Classification',
  extraction: 'Extraction',
  summary: 'Summary',
  draft: 'Draft',
  analysis: 'Analysis',
  chat: 'Chat',
};

export const PII_LABEL: Record<string, string> = {
  email: 'Emails',
  phone: 'Phone numbers',
  ni_number: 'NI numbers',
  card: 'Card numbers',
  iban: 'IBANs',
  postcode: 'Postcodes',
};

export function time(ts: string): string {
  return new Date(ts).toLocaleTimeString('en-GB', { hour12: false });
}

export async function sendChat(team: string, body: object, headers: Record<string, string> = {}) {
  const res = await fetch('/api/gw/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TEAM_KEYS[team]}`, ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
