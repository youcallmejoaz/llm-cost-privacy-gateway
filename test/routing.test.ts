import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, parseRouting } from '../src/config.js';
import { Router } from '../src/routing/router.js';
import samples from '../demo/sample-requests.json' with { type: 'json' };
import type { SampleRequest } from '../demo/generate-samples.js';
import { testApp } from './helpers.js';

const cfg = loadConfig();
const SAMPLES = samples as SampleRequest[];

describe('routing rules', () => {
  let ctx: Awaited<ReturnType<typeof testApp>>;
  afterEach(async () => ctx?.app.close());

  it('sends seeded simple requests to the small model and complex ones to the large model', async () => {
    ctx = await testApp({ config: (c) => c.teams.forEach((t) => (t.monthlyBudgetUsd = 100)) });
    const routable = SAMPLES.filter((s) => s.kind !== 'draft-with-card');
    expect(routable.length).toBeGreaterThan(190);
    const wrong: string[] = [];
    for (const s of routable) {
      const res = await ctx.chat(s.team, s.body);
      expect(res.statusCode).toBe(200);
      const model = res.headers['x-gateway-model'] as string;
      if (!cfg.models.tiers[s.expectTier].includes(model as never)) wrong.push(`#${s.id} ${s.kind} -> ${model} (${res.headers['x-gateway-route']})`);
    }
    expect(wrong).toEqual([]);
    const small = routable.filter((s) => s.expectTier === 'small').length;
    expect(small).toBeGreaterThan(80);
    expect(routable.length - small).toBeGreaterThan(60);
  });

  it('honours an explicit model and falls back to its equivalent', () => {
    const r = new Router(cfg);
    const team = cfg.teams[0];
    const d = r.decide({ requestedModel: 'gpt-4.1-mini', team, task: 'analysis', inputTokens: 9000, text: '' });
    expect(d.chain[0]).toBe('openai:gpt-4.1-mini');
    expect(d.chain).toContain('anthropic:claude-haiku-5-5');
    expect(d.rule).toBe('explicit-model');
  });

  it('supports team and task rules as data (e.g. Support classifications to the cheapest model)', () => {
    const custom = structuredClone(cfg);
    custom.routing = parseRouting({
      rules: [{ name: 'support-classification-cheapest', when: { team: 'Support', task: ['classification'] }, route: 'cheapest' }, ...cfg.routing.rules],
      default: 'large',
    });
    const r = new Router(custom);
    const support = cfg.teams.find((t) => t.id === 'support')!;
    const data = cfg.teams.find((t) => t.id === 'data')!;
    const s = r.decide({ requestedModel: 'auto', team: support, task: 'classification', inputTokens: 50, text: '' });
    expect(s.rule).toBe('support-classification-cheapest');
    expect(s.chain[0]).toBe('anthropic:claude-haiku-5-5'); // cheapest blended price in the sample table
    const d = r.decide({ requestedModel: 'auto', team: data, task: 'classification', inputTokens: 50, text: '' });
    expect(d.rule).toBe('classification-to-small');
  });

  it('sends very long inputs to the large model whatever the task', () => {
    const r = new Router(cfg);
    const d = r.decide({ requestedModel: 'auto', team: cfg.teams[0], task: 'classification', inputTokens: 7000, text: '' });
    expect(d.tier).toBe('large');
  });

  it('can use the optional cheap LLM classifier', async () => {
    ctx = await testApp({ env: { CLASSIFIER: 'llm' } });
    const res = await ctx.chat('support', { model: 'auto', messages: [{ role: 'user', content: 'Please classify this ticket: parcel lost' }] });
    expect(res.statusCode).toBe(200);
    const [row] = await ctx.gw.store.list({});
    expect(row.policy).toContain('classifier:llm');
    expect(row.task).toBe('classification');
    expect(ctx.mock('anthropic').received.length).toBe(2); // classifier call + the request
  });
});
