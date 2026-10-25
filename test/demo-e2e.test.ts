import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');
const port = 18000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;

describe('DEMO_MODE=1 end to end with no API keys', () => {
  let proc: ChildProcess;
  beforeAll(async () => {
    const env: NodeJS.ProcessEnv = { ...process.env, DEMO_MODE: '1', PORT: String(port), MOCK_LATENCY_SCALE: '0', LOG_LEVEL: 'warn' };
    for (const k of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY', 'REDIS_URL', 'DATABASE_URL', 'ADMIN_TOKEN']) delete env[k];
    proc = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], { cwd: root, env, stdio: 'pipe' });
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(`${base}/health`)).ok) return;
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('gateway did not start');
  });
  afterAll(() => {
    proc?.kill('SIGTERM');
  });

  it('starts, runs the seed traffic and reports savings', async () => {
    const health = await (await fetch(`${base}/health`)).json();
    expect(health.demoMode).toBe(true);
    expect(health.providers.every((p: any) => p.mock)).toBe(true);

    const seed = spawn(process.execPath, ['--import', 'tsx', 'demo/seed.ts'], { cwd: root, env: { ...process.env, GATEWAY_URL: base }, stdio: 'pipe' });
    let out = '';
    seed.stdout!.on('data', (d) => (out += d));
    const code = await new Promise((r) => seed.on('close', r));
    expect(code).toBe(0);
    expect(out).toContain('sent 200 requests');

    const summary = await (await fetch(`${base}/admin/summary`, { headers: { authorization: 'Bearer demo-admin' } })).json();
    expect(summary.totals.requests).toBe(200);
    expect(summary.totals.ok).toBeGreaterThan(150);
    expect(summary.totals.savedUsd).toBeGreaterThan(0);
    expect(summary.totals.redactions).toBeGreaterThan(100);
  });
});
