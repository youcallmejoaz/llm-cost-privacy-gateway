import { randomUUID } from 'node:crypto';
import { BudgetGuard, RateLimiter } from './budget.js';
import { ExactCache, SemanticCache, type CachedReply } from './cache.js';
import type { Env, GatewayConfig, TeamConfig } from './config.js';
import { Redactor } from './pii/redactor.js';
import { costUsd, estimateTokens, priceOf, roundMicro } from './pricing.js';
import { FallbackError, providerOf, type ProviderRegistry } from './providers/registry.js';
import { classifyTask, parseTaskLabel } from './routing/classifier.js';
import { Router } from './routing/router.js';
import type { Store } from './store/db.js';
import type { KV } from './store/kv.js';
import type { Attempt, CacheOutcome, LedgerEntry, ModelRef, NormalisedRequest, PiiType, ProviderId, RequestStatus, Task } from './types.js';

export const CLASSIFIER_MARKER = 'GATEWAY_TASK_CLASSIFIER';

export interface PipelineInput {
  endpoint: 'openai' | 'anthropic';
  rawKey: string | undefined;
  requestedModel: string;
  req: NormalisedRequest;
  /** Anthropic passthrough keeps traffic on Anthropic models. */
  onlyProvider?: ProviderId;
  cacheEnabled?: boolean;
}

export interface GatewayMeta {
  requestId: string;
  team: string;
  model: ModelRef | null;
  task: Task;
  rule: string;
  cache: CacheOutcome;
  costUsd: number;
  savedUsd: number;
  redactions: number;
  fallback: boolean;
}

export type PipelineResult =
  | { ok: true; text: string; inputTokens: number; outputTokens: number; finishReason: 'stop' | 'length' | 'other'; meta: GatewayMeta }
  | { ok: false; status: number; type: string; message: string; meta?: Partial<GatewayMeta>; retryAfterSeconds?: number };

export class Gateway {
  readonly router: Router;
  readonly budget: BudgetGuard;
  readonly rateLimiter: RateLimiter;
  readonly cache: ExactCache;
  readonly semantic: SemanticCache | null;
  private teams = new Map<string, TeamConfig>();

  constructor(
    readonly env: Env,
    public cfg: GatewayConfig,
    readonly providers: ProviderRegistry,
    readonly kv: KV,
    readonly store: Store,
  ) {
    this.router = new Router(cfg);
    this.budget = new BudgetGuard(kv, store);
    this.rateLimiter = new RateLimiter(kv);
    this.cache = new ExactCache(kv, env.CACHE_TTL_SECONDS);
    this.semantic = env.SEMANTIC_CACHE ? new SemanticCache(env.SEMANTIC_CACHE_THRESHOLD, env.CACHE_TTL_SECONDS) : null;
    this.setConfig(cfg);
  }

  setConfig(cfg: GatewayConfig): void {
    this.cfg = cfg;
    this.router.setConfig(cfg);
    this.teams = new Map(cfg.teams.map((t) => [t.id, t]));
  }

  team(id: string): TeamConfig | undefined {
    return this.teams.get(id);
  }

  teamList(): TeamConfig[] {
    return [...this.teams.values()];
  }

  async handle(input: PipelineInput): Promise<PipelineResult> {
    const started = Date.now();
    const id = `req_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

    // 1. Who is calling?
    const key = input.rawKey ? await this.store.findKey(input.rawKey) : null;
    const team = key ? this.teams.get(key.teamId) : undefined;
    if (!key || !team) {
      return { ok: false, status: 401, type: 'invalid_api_key', message: 'Missing or unknown gateway key. Use the virtual key issued to your team.' };
    }

    const entry: LedgerEntry = {
      id,
      ts: new Date().toISOString(),
      teamId: team.id,
      keyId: key.id,
      endpoint: input.endpoint,
      requestedModel: input.requestedModel,
      routedModel: null,
      routeRule: '',
      task: 'chat',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      baselineModel: team.defaultModel,
      baselineCostUsd: 0,
      savedUsd: 0,
      cache: 'skipped',
      redactions: {},
      policy: [],
      status: 'ok',
      httpStatus: 200,
      attempts: [],
      fallbackUsed: false,
      latencyMs: 0,
    };
    const finish = async (status: RequestStatus, httpStatus: number) => {
      entry.status = status;
      entry.httpStatus = httpStatus;
      entry.latencyMs = Date.now() - started;
      await this.store.insert(entry);
    };
    const meta = (): GatewayMeta => ({
      requestId: id,
      team: team.id,
      model: entry.routedModel,
      task: entry.task,
      rule: entry.routeRule,
      cache: entry.cache,
      costUsd: entry.costUsd,
      savedUsd: entry.savedUsd,
      redactions: Object.values(entry.redactions).reduce((a, b) => a + (b ?? 0), 0),
      fallback: entry.fallbackUsed,
    });

    // 2. Rate limit per key.
    const rl = await this.rateLimiter.hit(key.id, team.rpmLimit);
    if (!rl.ok) {
      entry.policy.push(`rate_limit:${team.rpmLimit}/min`);
      await finish('rate_limited', 429);
      return { ok: false, status: 429, type: 'rate_limited', message: `Too many requests for the ${team.name} team (limit ${team.rpmLimit} per minute). Please retry in ${rl.retryAfterSeconds} seconds.`, retryAfterSeconds: rl.retryAfterSeconds, meta: meta() };
    }

    // 3. Allowed models.
    const requested = input.requestedModel || 'auto';
    if (!this.isAllowed(team, requested)) {
      entry.policy.push(`model_not_allowed:${requested}`);
      await finish('forbidden_model', 403);
      return { ok: false, status: 403, type: 'model_not_allowed', message: `The ${team.name} team is not allowed to use "${requested}". Allowed: ${team.allowedModels.join(', ')}.`, meta: meta() };
    }

    // 4. Personal data: block or replace with tokens before anything leaves.
    const redactor = new Redactor();
    let req: NormalisedRequest = input.req;
    if (team.pii.mode !== 'off') {
      req = { ...input.req, messages: input.req.messages.map((m) => ({ ...m, content: redactor.redact(m.content).text })) };
      entry.redactions = { ...redactor.counts };
      const blocked = redactor.typesFound().filter((t) => team.pii.mode === 'block' || team.pii.blockTypes.includes(t));
      if (blocked.length) {
        entry.policy.push(`pii_blocked:${blocked.join(',')}`);
        await finish('blocked_pii', 422);
        return { ok: false, status: 422, type: 'pii_blocked', message: `This request contains ${blocked.map(label).join(' and ')}, which the ${team.name} team policy does not allow to be sent to an AI provider. Remove it and try again. Nothing was sent.`, meta: meta() };
      }
      if (redactor.total) entry.policy.push(`pii_redacted:${redactor.total}`);
    } else {
      entry.policy.push('pii:off');
    }
    if (this.env.AUDIT_STORE_REDACTED_PROMPTS) entry.redactedPrompt = req.messages.map((m) => `${m.role}: ${m.content}`).join('\n').slice(0, 4000);

    // 5. Classify and route.
    const allText = req.messages.map((m) => m.content).join('\n');
    const inputTokensEst = estimateTokens(allText) + 4 * req.messages.length;
    let classifierCost = 0;
    entry.task = classifyTask(req.messages);
    if ((this.env.CLASSIFIER ?? this.cfg.routing.classifier) === 'llm' && (requested === 'auto')) {
      const r = await this.llmClassify(req);
      if (r) {
        entry.task = r.task;
        classifierCost = r.costUsd;
        entry.policy.push('classifier:llm');
      }
    }
    let decision = this.router.decide({ requestedModel: requested, team, task: entry.task, inputTokens: inputTokensEst, text: allText });
    if (input.onlyProvider) {
      const chain = decision.chain.filter((m) => providerOf(m) === input.onlyProvider);
      decision = { ...decision, chain: chain.length ? chain : this.router.resolveTarget(decision.tier === 'small' ? 'small' : 'large', decision.rule).chain.filter((m) => providerOf(m) === input.onlyProvider) };
    }
    decision = { ...decision, chain: decision.chain.filter((m) => this.providers.available(m)) };
    entry.routeRule = decision.rule;
    if (decision.tier === 'explicit') entry.baselineModel = decision.chain[0] ?? team.defaultModel;
    const primary = decision.chain[0];
    if (!primary) {
      await finish('error', 503);
      return { ok: false, status: 503, type: 'no_provider', message: 'No configured provider can serve this model. Add an API key or enable demo mode.', meta: meta() };
    }

    // 6. Cache (redacted text only). Cache hits cost nothing, so they are served even when a budget is used up.
    const scope = this.env.CACHE_SCOPE === 'team' ? team.id : 'global';
    const modelKey = `${input.endpoint}|${requested}|${primary}`;
    const useCache = input.cacheEnabled !== false;
    const cacheKey = this.cache.key(scope, modelKey, req);
    if (useCache) {
      let hit: CachedReply | null = await this.cache.get(cacheKey);
      let kind: CacheOutcome = 'exact';
      if (!hit && this.semantic) {
        const s = this.semantic.get(scope, modelKey, req);
        if (s) {
          hit = s.value;
          kind = 'semantic';
        }
      }
      if (hit) {
        entry.cache = kind;
        entry.routedModel = hit.model;
        entry.inputTokens = hit.inputTokens;
        entry.outputTokens = hit.outputTokens;
        entry.costUsd = 0;
        entry.baselineCostUsd = costUsd(this.cfg.prices, entry.baselineModel, hit.inputTokens, hit.outputTokens);
        entry.savedUsd = entry.baselineCostUsd;
        await finish('ok', 200);
        return { ok: true, text: redactor.restore(hit.text), inputTokens: hit.inputTokens, outputTokens: hit.outputTokens, finishReason: 'stop', meta: meta() };
      }
      entry.cache = 'miss';
    }

    // 7. Budget, before any money is spent.
    const p = priceOf(this.cfg.prices, primary);
    const estimate = (inputTokensEst * p.input + (req.maxTokens ?? 512) * p.output) / 1_000_000 + classifierCost;
    const reservation = await this.budget.reserve(team, estimate);
    if (!reservation.ok) {
      entry.policy.push('budget_exceeded');
      await finish('blocked_budget', 429);
      return {
        ok: false,
        status: 429,
        type: 'budget_exceeded',
        message: `The ${team.name} team has reached its monthly AI budget: $${reservation.spentUsd.toFixed(4)} of $${team.monthlyBudgetUsd.toFixed(2)} used, and this request could cost up to $${estimate.toFixed(4)}. Ask your admin to raise the budget, or try again next month. Nothing was sent to any AI provider.`,
        retryAfterSeconds: secondsToNextMonth(),
        meta: meta(),
      };
    }

    // 8. Call the provider, falling back on errors and timeouts.
    let attempts: Attempt[] = [];
    try {
      const result = await this.providers.callWithFallback(decision.chain, req, this.env.PROVIDER_TIMEOUT_MS);
      attempts = result.attempts;
      const { res, model } = result;
      entry.attempts = attempts;
      entry.routedModel = model;
      entry.fallbackUsed = model !== primary;
      entry.inputTokens = res.inputTokens;
      entry.outputTokens = res.outputTokens;
      entry.costUsd = roundMicro(costUsd(this.cfg.prices, model, res.inputTokens, res.outputTokens) + classifierCost);
      entry.baselineCostUsd = costUsd(this.cfg.prices, entry.baselineModel, res.inputTokens, res.outputTokens);
      entry.savedUsd = roundMicro(entry.baselineCostUsd - entry.costUsd);
      if (entry.fallbackUsed) entry.policy.push(`fallback:${primary}->${model}`);
      await this.budget.settle(team.id, reservation.reservedMicro, entry.costUsd);
      if (useCache) {
        const value: CachedReply = { text: res.text, model, inputTokens: res.inputTokens, outputTokens: res.outputTokens, costUsd: entry.costUsd };
        await this.cache.set(cacheKey, value);
        this.semantic?.set(scope, modelKey, req, value);
      }
      await finish('ok', 200);
      return { ok: true, text: redactor.restore(res.text), inputTokens: res.inputTokens, outputTokens: res.outputTokens, finishReason: res.finishReason, meta: meta() };
    } catch (err) {
      await this.budget.settle(team.id, reservation.reservedMicro, classifierCost);
      entry.costUsd = classifierCost;
      entry.attempts = err instanceof FallbackError ? err.attempts : attempts;
      const status = err instanceof FallbackError ? err.status : 502;
      await finish('error', status);
      return { ok: false, status, type: 'provider_error', message: (err as Error).message, meta: meta() };
    }
  }

  private isAllowed(team: TeamConfig, requested: string): boolean {
    if (team.allowedModels.includes('*') || team.allowedModels.includes(requested)) return true;
    if (['auto', 'small', 'large', 'cheapest'].includes(requested)) return false;
    return team.allowedModels.includes(this.router.normaliseModel(requested));
  }

  /** Optional cheap classifier: asks the cheapest model for a one word task label. */
  private async llmClassify(req: NormalisedRequest): Promise<{ task: Task; costUsd: number } | null> {
    const chain = this.router.resolveTarget('cheapest', 'classifier').chain.filter((m) => this.providers.available(m));
    if (!chain.length) return null;
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    try {
      const { res, model } = await this.providers.callWithFallback(
        chain,
        {
          messages: [
            { role: 'system', content: `${CLASSIFIER_MARKER}: Label the user's request with exactly one word from: classification, extraction, summary, draft, analysis, chat.` },
            { role: 'user', content: lastUser.slice(0, 2000) },
          ],
          maxTokens: 5,
        },
        Math.min(this.env.PROVIDER_TIMEOUT_MS, 5000),
      );
      const task = parseTaskLabel(res.text);
      return task ? { task, costUsd: costUsd(this.cfg.prices, model, res.inputTokens, res.outputTokens) } : null;
    } catch {
      return null;
    }
  }
}

function label(t: PiiType): string {
  return { email: 'an email address', phone: 'a phone number', ni_number: 'a National Insurance number', card: 'a card number', iban: 'a bank account number (IBAN)', postcode: 'a postcode' }[t];
}

function secondsToNextMonth(): number {
  const d = new Date();
  return Math.ceil((Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - d.getTime()) / 1000);
}
