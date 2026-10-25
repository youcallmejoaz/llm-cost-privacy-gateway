import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import samples from '../demo/sample-requests.json' with { type: 'json' };
import type { SampleRequest } from '../demo/generate-samples.js';
import { costUsd } from '../src/pricing.js';
import type { LedgerEntry } from '../src/types.js';
import { testApp } from './helpers.js';

describe('cost ledger', () => {
  let ctx: Awaited<ReturnType<typeof testApp>>;
  let rows: LedgerEntry[];
  let summary: any;

  beforeAll(async () => {
    ctx = await testApp();
    for (const s of samples as SampleRequest[]) await ctx.chat(s.team, s.body);
    rows = await ctx.gw.store.list({});
    summary = (await ctx.admin('GET', '/admin/summary')).json();
  });
  afterAll(async () => ctx.app.close());

  it('records every request, including blocked ones', () => {
    expect(rows).toHaveLength(200);
    expect(summary.totals.requests).toBe(200);
    expect(summary.totals.blockedPii).toBe(2);
    expect(summary.totals.blockedBudget).toBeGreaterThan(0); // Marketing's small demo budget runs out
  });

  it('matches the price table maths for every call', () => {
    const prices = ctx.gw.cfg.prices;
    for (const r of rows.filter((x) => x.status === 'ok')) {
      const expected = r.cache === 'miss' ? costUsd(prices, r.routedModel!, r.inputTokens, r.outputTokens) : 0;
      expect(r.costUsd).toBeCloseTo(expected, 6);
      expect(r.baselineCostUsd).toBeCloseTo(costUsd(prices, r.baselineModel, r.inputTokens, r.outputTokens), 6);
      expect(r.savedUsd).toBeCloseTo(r.baselineCostUsd - r.costUsd, 6);
    }
    // Spot check by hand: Haiku sample price is $0.10 in / $0.50 out per million tokens.
    expect(costUsd(prices, 'anthropic:claude-haiku-5-5', 1_000_000, 1_000_000)).toBe(0.6);
    expect(costUsd(prices, 'anthropic:claude-sonnet-5-5', 1200, 300)).toBe(0.0054);
  });

  it('adds up: totals, team breakdown and budget counters agree with the rows', () => {
    const total = rows.reduce((a, r) => a + r.costUsd, 0);
    expect(summary.totals.spendUsd).toBeCloseTo(total, 6);
    const teamSum = summary.teams.reduce((a: number, t: any) => a + t.spendUsd, 0);
    expect(teamSum).toBeCloseTo(total, 6);
    for (const t of summary.teams) expect(t.budgetUsedUsd).toBeCloseTo(t.spendUsd, 6);
    expect(summary.totals.savedUsd).toBeCloseTo(summary.totals.savedRoutingUsd + summary.totals.savedCacheUsd, 6);
    expect(summary.totals.savedUsd).toBeCloseTo(summary.totals.baselineUsd - rows.filter((r) => r.status === 'ok').reduce((a, r) => a + r.costUsd, 0), 6);
    expect(summary.totals.savedUsd).toBeGreaterThan(0);
  });

  it('keeps every team within its budget', () => {
    for (const t of summary.teams) expect(t.budgetUsedUsd).toBeLessThanOrEqual(t.budgetUsd);
  });
});
