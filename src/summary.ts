import { monthStartIso } from './budget.js';
import type { Gateway } from './pipeline.js';
import { roundMicro } from './pricing.js';
import type { LedgerEntry, PiiType } from './types.js';

const r = roundMicro;

export async function buildSummary(gw: Gateway) {
  const rows = await gw.store.list({ since: monthStartIso() });
  const now = Date.now();
  const totals = {
    requests: rows.length,
    ok: 0,
    blockedBudget: 0,
    blockedPii: 0,
    rateLimited: 0,
    errors: 0,
    spendUsd: 0,
    baselineUsd: 0,
    savedUsd: 0,
    savedRoutingUsd: 0,
    savedCacheUsd: 0,
    cacheHits: 0,
    cacheMisses: 0,
    cacheHitRate: 0,
    redactions: 0,
    fallbacks: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
  const redactionsByType: Partial<Record<PiiType, number>> = {};
  const byTeam = new Map<string, { requests: number; spendUsd: number; savedUsd: number; blocked: number }>();
  const byModel = new Map<string, { requests: number; spendUsd: number; tokens: number }>();
  const byTask = new Map<string, { requests: number; spendUsd: number; small: number }>();
  const BUCKET = 10_000;
  const start = Math.floor((now - 10 * 60_000) / BUCKET) * BUCKET;
  const timeline = new Map<number, { ok: number; errors: number; fallbacks: number; blocked: number }>();

  for (const e of rows) {
    totals.spendUsd += e.costUsd;
    totals.inputTokens += e.inputTokens;
    totals.outputTokens += e.outputTokens;
    if (e.status === 'ok') {
      totals.ok++;
      totals.baselineUsd += e.baselineCostUsd;
      totals.savedUsd += e.savedUsd;
      if (e.cache === 'exact' || e.cache === 'semantic') totals.savedCacheUsd += e.savedUsd;
      else totals.savedRoutingUsd += e.savedUsd;
    } else if (e.status === 'blocked_budget') totals.blockedBudget++;
    else if (e.status === 'blocked_pii') totals.blockedPii++;
    else if (e.status === 'rate_limited') totals.rateLimited++;
    else if (e.status === 'error') totals.errors++;
    if (e.cache === 'exact' || e.cache === 'semantic') totals.cacheHits++;
    if (e.cache === 'miss') totals.cacheMisses++;
    if (e.fallbackUsed) totals.fallbacks++;
    for (const [t, n] of Object.entries(e.redactions)) {
      redactionsByType[t as PiiType] = (redactionsByType[t as PiiType] ?? 0) + (n ?? 0);
      totals.redactions += n ?? 0;
    }
    const tm = byTeam.get(e.teamId) ?? { requests: 0, spendUsd: 0, savedUsd: 0, blocked: 0 };
    tm.requests++;
    tm.spendUsd += e.costUsd;
    if (e.status === 'ok') tm.savedUsd += e.savedUsd;
    if (e.status.startsWith('blocked') || e.status === 'rate_limited') tm.blocked++;
    byTeam.set(e.teamId, tm);
    if (e.routedModel && e.status === 'ok') {
      const m = byModel.get(e.routedModel) ?? { requests: 0, spendUsd: 0, tokens: 0 };
      m.requests++;
      m.spendUsd += e.costUsd;
      m.tokens += e.inputTokens + e.outputTokens;
      byModel.set(e.routedModel, m);
      const tk = byTask.get(e.task) ?? { requests: 0, spendUsd: 0, small: 0 };
      tk.requests++;
      tk.spendUsd += e.costUsd;
      if (gw.cfg.models.tiers.small.includes(e.routedModel)) tk.small++;
      byTask.set(e.task, tk);
    }
    const ts = Date.parse(e.ts);
    if (ts >= start) {
      const b = Math.floor(ts / BUCKET) * BUCKET;
      const tb = timeline.get(b) ?? { ok: 0, errors: 0, fallbacks: 0, blocked: 0 };
      if (e.status === 'ok') tb.ok++;
      else if (e.status === 'error') tb.errors++;
      else tb.blocked++;
      if (e.fallbackUsed) tb.fallbacks++;
      timeline.set(b, tb);
    }
  }
  totals.cacheHitRate = totals.cacheHits + totals.cacheMisses ? totals.cacheHits / (totals.cacheHits + totals.cacheMisses) : 0;
  for (const k of ['spendUsd', 'baselineUsd', 'savedUsd', 'savedRoutingUsd', 'savedCacheUsd'] as const) totals[k] = r(totals[k]);

  const teams = await Promise.all(
    gw.teamList().map(async (t) => {
      const s = byTeam.get(t.id) ?? { requests: 0, spendUsd: 0, savedUsd: 0, blocked: 0 };
      return { id: t.id, name: t.name, budgetUsd: t.monthlyBudgetUsd, budgetUsedUsd: r(await gw.budget.spentUsd(t.id)), ...s, spendUsd: r(s.spendUsd), savedUsd: r(s.savedUsd) };
    }),
  );

  const buckets: Array<{ t: number; ok: number; errors: number; fallbacks: number; blocked: number }> = [];
  for (let b = start; b <= now; b += BUCKET) buckets.push({ t: b, ...(timeline.get(b) ?? { ok: 0, errors: 0, fallbacks: 0, blocked: 0 }) });

  return {
    generatedAt: new Date(now).toISOString(),
    monthStart: monthStartIso(),
    demoMode: gw.env.DEMO_MODE,
    priceLabel: gw.cfg.prices._label,
    totals,
    redactionsByType,
    teams,
    models: [...byModel].map(([model, v]) => ({ model, ...v, spendUsd: r(v.spendUsd), tier: gw.cfg.models.tiers.small.includes(model as never) ? 'small' : 'large' })).sort((a, b) => b.spendUsd - a.spendUsd),
    tasks: [...byTask].map(([task, v]) => ({ task, ...v, spendUsd: r(v.spendUsd) })),
    timeline: buckets,
    providers: gw.providers.status(),
    recent: rows.slice(0, 40).map(publicRow),
  };
}

/** What the dashboard sees for one request. No prompt text exists to show. */
export function publicRow(e: LedgerEntry) {
  const { redactedPrompt: _omit, ...rest } = e;
  return rest;
}
