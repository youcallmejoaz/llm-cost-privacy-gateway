import { afterEach, describe, expect, it } from 'vitest';
import { testApp } from './helpers.js';

const draft = { model: 'auto', max_tokens: 600, messages: [{ role: 'user', content: 'Write a newsletter about our winter offer for trial users.' }] };

describe('budgets and limits are enforced before the call', () => {
  let ctx: Awaited<ReturnType<typeof testApp>>;
  afterEach(async () => ctx.app.close());

  it('returns a friendly 429 and makes no provider call when a team is over budget', async () => {
    ctx = await testApp({ config: (c) => (c.teams.find((t) => t.id === 'marketing')!.monthlyBudgetUsd = 0) });
    const res = await ctx.chat('marketing', draft);
    expect(res.statusCode).toBe(429);
    const err = res.json().error;
    expect(err.type).toBe('budget_exceeded');
    expect(err.message).toMatch(/Marketing team has reached its monthly AI budget/);
    expect(err.message).toMatch(/Nothing was sent to any AI provider/);
    expect(res.headers['retry-after']).toBeDefined();
    expect(ctx.allReceived()).toHaveLength(0);
    const [row] = await ctx.gw.store.list({});
    expect(row.status).toBe('blocked_budget');
    expect(row.costUsd).toBe(0);
  });

  it('never lets concurrent requests push spend past the budget', async () => {
    ctx = await testApp({ config: (c) => (c.teams.find((t) => t.id === 'marketing')!.monthlyBudgetUsd = 0.02) });
    const bodies = Array.from({ length: 30 }, (_, i) => ({ ...draft, messages: [{ role: 'user', content: `${draft.messages[0].content} Variant ${i}.` }] }));
    const results = await Promise.all(bodies.map((b) => ctx.chat('marketing', b)));
    const ok = results.filter((r) => r.statusCode === 200).length;
    const blocked = results.filter((r) => r.statusCode === 429).length;
    expect(ok).toBeGreaterThan(0);
    expect(blocked).toBeGreaterThan(0);
    expect(ctx.allReceived()).toHaveLength(ok);
    expect(await ctx.gw.budget.spentUsd('marketing')).toBeLessThanOrEqual(0.02);
  });

  it('serves cache hits even when the budget is used up, because they cost nothing', async () => {
    ctx = await testApp();
    expect((await ctx.chat('marketing', draft)).statusCode).toBe(200);
    ctx.gw.team('marketing')!.monthlyBudgetUsd = 0;
    const again = await ctx.chat('marketing', draft);
    expect(again.statusCode).toBe(200);
    expect(again.headers['x-gateway-cache']).toBe('exact');
  });

  it('rate limits per key', async () => {
    ctx = await testApp({ config: (c) => (c.teams.find((t) => t.id === 'support')!.rpmLimit = 2) });
    const body = (i: number) => ({ model: 'auto', messages: [{ role: 'user', content: `Classify ticket ${i}` }] });
    expect((await ctx.chat('support', body(1))).statusCode).toBe(200);
    expect((await ctx.chat('support', body(2))).statusCode).toBe(200);
    const third = await ctx.chat('support', body(3));
    expect(third.statusCode).toBe(429);
    expect(third.json().error.type).toBe('rate_limited');
  });

  it('rejects models the team is not allowed to use, and unknown keys', async () => {
    ctx = await testApp();
    const res = await ctx.chat('marketing', { model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'hi' }] });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.type).toBe('model_not_allowed');
    const anon = await ctx.app.inject({ method: 'POST', url: '/v1/chat/completions', headers: { authorization: 'Bearer nope' }, payload: { messages: [{ role: 'user', content: 'hi' }] } });
    expect(anon.statusCode).toBe(401);
    expect(ctx.allReceived()).toHaveLength(0);
  });
});
