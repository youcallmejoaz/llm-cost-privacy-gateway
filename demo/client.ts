/** Tiny helper used by the demo scripts to talk to a running gateway. */
import samples from './sample-requests.json' with { type: 'json' };
import type { SampleRequest } from './generate-samples.js';

export const GATEWAY_URL = process.env.GATEWAY_URL ?? 'http://localhost:8787';
export const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? 'demo-admin';
export const DEMO_KEYS: Record<string, string> = {
  support: process.env.SUPPORT_KEY ?? 'demo-key-support',
  marketing: process.env.MARKETING_KEY ?? 'demo-key-marketing',
  data: process.env.DATA_KEY ?? 'demo-key-data',
};

export const SAMPLES = samples as SampleRequest[];

export async function send(team: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${DEMO_KEYS[team]}`, ...headers },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as any;
  return { status: res.status, json };
}

export async function admin(pathname: string, body?: unknown) {
  const res = await fetch(`${GATEWAY_URL}${pathname}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${ADMIN_TOKEN}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) throw new Error(`${pathname} -> ${res.status} ${await res.text()}`);
  return (await res.json()) as any;
}

export async function waitForGateway(timeoutMs = 30_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      if ((await fetch(`${GATEWAY_URL}/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`gateway not reachable at ${GATEWAY_URL}`);
}
