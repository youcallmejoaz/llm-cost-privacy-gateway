import { afterEach, describe, expect, it } from 'vitest';
import { testApp } from './helpers.js';

const body = { model: 'auto', messages: [{ role: 'user', content: 'Summarise: customer jane.doe@example.com reports a lost parcel from order ORD-41234.' }] };

describe('cache', () => {
  let ctx: Awaited<ReturnType<typeof testApp>>;
  afterEach(async () => ctx.app.close());

  it('serves the second identical request from cache at zero cost and records the saving', async () => {
    ctx = await testApp();
    const first = await ctx.chat('support', body);
    const second = await ctx.chat('support', { ...body, messages: [{ role: 'user', content: `  ${body.messages[0].content}  ` }] });
    expect(first.headers['x-gateway-cache']).toBe('miss');
    expect(second.headers['x-gateway-cache']).toBe('exact');
    expect(Number(second.headers['x-gateway-cost-usd'])).toBe(0);
    expect(second.json().choices[0].message.content).toBe(first.json().choices[0].message.content);
    expect(ctx.allReceived()).toHaveLength(1);
    const [hit, miss] = await ctx.gw.store.list({});
    expect(hit.costUsd).toBe(0);
    expect(hit.savedUsd).toBeGreaterThan(0);
    expect(hit.savedUsd).toBe(hit.baselineCostUsd);
    expect(miss.costUsd).toBeGreaterThan(0);
  });

  it('shares an entry across different personal data and restores each caller\'s own values', async () => {
    ctx = await testApp();
    await ctx.chat('support', body);
    const other = await ctx.chat('support', { ...body, messages: [{ role: 'user', content: body.messages[0].content.replace('jane.doe@example.com', 'sam.patel@example.co.uk') }] });
    expect(other.headers['x-gateway-cache']).toBe('exact');
    expect(other.json().choices[0].message.content).toContain('sam.patel@example.co.uk');
    expect(other.json().choices[0].message.content).not.toContain('jane.doe');
  });

  it('keeps teams apart and can be bypassed per request', async () => {
    ctx = await testApp();
    await ctx.chat('support', body);
    expect((await ctx.chat('data', body)).headers['x-gateway-cache']).toBe('miss');
    expect((await ctx.chat('support', body, { 'x-gateway-cache': 'off' })).headers['x-gateway-cache']).toBe('skipped');
  });

  it('optional semantic cache matches near duplicates', async () => {
    ctx = await testApp({ env: { SEMANTIC_CACHE: '1', SEMANTIC_CACHE_THRESHOLD: '0.85' } });
    await ctx.chat('support', body);
    const near = await ctx.chat('support', { ...body, messages: [{ role: 'user', content: 'Summarise: customer jane.doe@example.com reports a lost parcel from order ORD-41234 today.' }] });
    expect(near.headers['x-gateway-cache']).toBe('semantic');
  });
});

describe('fallback', () => {
  let ctx: Awaited<ReturnType<typeof testApp>>;
  afterEach(async () => ctx.app.close());

  it('succeeds through the fallback provider when the primary returns errors', async () => {
    ctx = await testApp();
    ctx.gw.providers.faults.set('anthropic', 'error');
    const res = await ctx.chat('support', body);
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-gateway-model']).toBe('openai:gpt-4.1-mini');
    expect(res.headers['x-gateway-fallback']).toBe('true');
    expect(res.json().choices[0].message.content).toContain('jane.doe@example.com');
    const [row] = await ctx.gw.store.list({});
    expect(row.attempts.map((a) => [a.model, a.outcome])).toEqual([
      ['anthropic:claude-haiku-5-5', 'error'],
      ['openai:gpt-4.1-mini', 'ok'],
    ]);
    expect(row.costUsd).toBeGreaterThan(0);
  });

  it('falls back on timeouts', async () => {
    ctx = await testApp({ env: { PROVIDER_TIMEOUT_MS: '100' } });
    ctx.gw.providers.faults.set('anthropic', 'timeout');
    const res = await ctx.chat('data', { model: 'auto', messages: [{ role: 'user', content: 'Analyse the churn numbers for Q3 and recommend actions.' }] });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-gateway-model']).toBe('openai:gpt-4.1');
    const [row] = await ctx.gw.store.list({});
    expect(row.attempts[0].outcome).toBe('timeout');
  });

  it('skips a failing provider quickly once its circuit opens', async () => {
    ctx = await testApp();
    ctx.gw.providers.faults.set('anthropic', 'error');
    for (let i = 0; i < 4; i++) await ctx.chat('support', { ...body, messages: [{ role: 'user', content: `Classify ticket ${i}` }] });
    const [latest] = await ctx.gw.store.list({});
    expect(latest.attempts[0].outcome).toBe('skipped');
    expect(latest.status).toBe('ok');
  });

  it('returns a clear 502 when every provider is down, and charges nothing', async () => {
    ctx = await testApp();
    for (const p of ['anthropic', 'openai', 'google'] as const) ctx.gw.providers.faults.set(p, 'error');
    const res = await ctx.chat('support', body);
    expect(res.statusCode).toBe(502);
    expect(await ctx.gw.budget.spentUsd('support')).toBe(0);
  });
});
