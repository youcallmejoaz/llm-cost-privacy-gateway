import { Writable } from 'node:stream';
import { buildApp } from '../src/app.js';
import { loadConfig, loadEnv, type GatewayConfig } from '../src/config.js';
import type { MockProvider } from '../src/providers/mock.js';
import type { Store } from '../src/store/db.js';
import type { KV } from '../src/store/kv.js';
import type { ProviderId } from '../src/types.js';
import fake from '../fixtures/fake-pii.json' with { type: 'json' };

export const FAKE_PII: string[] = Object.entries(fake)
  .filter(([k]) => !k.startsWith('_'))
  .flatMap(([, v]) => v as string[]);

export const KEYS = { support: 'demo-key-support', marketing: 'demo-key-marketing', data: 'demo-key-data' } as const;

export async function testApp(opts: { env?: Record<string, string>; config?: (c: GatewayConfig) => void; store?: Store; kv?: KV } = {}) {
  const logs: string[] = [];
  const logStream = new Writable({
    write(chunk, _enc, cb) {
      logs.push(chunk.toString());
      cb();
    },
  });
  const env = loadEnv({ DEMO_MODE: '1', MOCK_LATENCY_SCALE: '0', LOG_LEVEL: 'debug', ...opts.env });
  const config = loadConfig();
  opts.config?.(config);
  const { app, gw } = await buildApp({ env, config, logStream, store: opts.store, kv: opts.kv });
  const mock = (id: ProviderId) => gw.providers.get(id) as MockProvider;
  const chat = (team: keyof typeof KEYS, body: object, headers: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url: '/v1/chat/completions', headers: { authorization: `Bearer ${KEYS[team]}`, ...headers }, payload: body });
  const admin = (method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({ method, url, headers: { authorization: 'Bearer demo-admin' }, ...(payload ? { payload } : {}) });
  const allReceived = () => (['anthropic', 'openai', 'google'] as const).flatMap((p) => mock(p).received);
  return { app, gw, logs, mock, chat, admin, allReceived };
}
