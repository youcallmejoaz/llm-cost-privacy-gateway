import type { Env } from '../config.js';
import type { Attempt, ModelRef, NormalisedRequest, NormalisedResponse, ProviderId } from '../types.js';
import { AnthropicProvider } from './anthropic.js';
import { FaultController } from './faults.js';
import { GoogleProvider } from './google.js';
import { MockProvider } from './mock.js';
import { OpenAIProvider } from './openai.js';
import { ProviderError, type Provider } from './types.js';

export const PROVIDER_IDS: ProviderId[] = ['anthropic', 'openai', 'google'];

interface Health {
  ok: number;
  errors: number;
  consecutiveFailures: number;
  openUntil: number;
  /** Per 5 second bucket: [bucketStartMs, ok, errors] for the last 10 minutes. */
  timeline: Array<[number, number, number]>;
}

const BREAKER_THRESHOLD = 3;
const BREAKER_OPEN_MS = 15_000;
const BUCKET_MS = 5_000;

export class FallbackError extends Error {
  constructor(message: string, readonly attempts: Attempt[], readonly status: number) {
    super(message);
  }
}

export class ProviderRegistry {
  readonly faults = new FaultController();
  private providers = new Map<ProviderId, Provider>();
  private health = new Map<ProviderId, Health>();

  constructor(env: Env, overrides?: Partial<Record<ProviderId, Provider>>) {
    for (const id of PROVIDER_IDS) {
      const p = overrides?.[id] ?? createProvider(id, env, this.faults);
      if (p) this.providers.set(id, p);
      this.health.set(id, { ok: 0, errors: 0, consecutiveFailures: 0, openUntil: 0, timeline: [] });
    }
  }

  get(id: ProviderId): Provider | undefined {
    return this.providers.get(id);
  }

  available(model: ModelRef): boolean {
    return this.providers.has(providerOf(model));
  }

  /**
   * Try each model in order. Retryable failures (5xx, 429, timeouts, network)
   * move on to the next provider; a request the vendor rejects as invalid stops here.
   */
  async callWithFallback(
    chain: ModelRef[],
    req: NormalisedRequest,
    timeoutMs: number,
  ): Promise<{ res: NormalisedResponse; model: ModelRef; attempts: Attempt[] }> {
    const attempts: Attempt[] = [];
    const usable = chain.filter((m) => this.available(m));
    if (usable.length === 0) throw new FallbackError('No configured provider for this model. Add an API key or enable DEMO_MODE.', attempts, 503);

    for (let i = 0; i < usable.length; i++) {
      const model = usable[i];
      const pid = providerOf(model);
      const h = this.health.get(pid)!;
      const isLast = i === usable.length - 1;
      if (h.openUntil > Date.now() && !isLast) {
        attempts.push({ model, outcome: 'skipped', ms: 0, error: 'circuit open after repeated failures' });
        continue;
      }
      const started = Date.now();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(new ProviderError(`${pid} timed out after ${timeoutMs} ms`, pid, true, 'timeout')), timeoutMs);
      try {
        const res = await this.providers.get(pid)!.chat(modelName(model), req, ctrl.signal);
        attempts.push({ model, outcome: 'ok', ms: Date.now() - started });
        this.record(pid, true);
        return { res, model, attempts };
      } catch (err) {
        const pe = ctrl.signal.aborted && ctrl.signal.reason instanceof ProviderError ? ctrl.signal.reason : err instanceof ProviderError ? err : new ProviderError(String((err as Error)?.message ?? err), pid, true);
        attempts.push({ model, outcome: pe.kind === 'timeout' ? 'timeout' : 'error', ms: Date.now() - started, error: pe.message });
        this.record(pid, false);
        if (!pe.retryable) throw new FallbackError(pe.message, attempts, 502);
      } finally {
        clearTimeout(timer);
      }
    }
    throw new FallbackError('All providers failed for this request', attempts, 502);
  }

  status() {
    const now = Date.now();
    return PROVIDER_IDS.map((id) => {
      const h = this.health.get(id)!;
      const p = this.providers.get(id);
      return {
        id,
        configured: Boolean(p),
        mock: p?.mock ?? false,
        fault: this.faults.get(id),
        ok: h.ok,
        errors: h.errors,
        circuitOpen: h.openUntil > now,
        timeline: h.timeline.filter(([t]) => t > now - 10 * 60_000),
      };
    });
  }

  resetHealth(): void {
    for (const h of this.health.values()) Object.assign(h, { ok: 0, errors: 0, consecutiveFailures: 0, openUntil: 0, timeline: [] });
  }

  private record(pid: ProviderId, ok: boolean): void {
    const h = this.health.get(pid)!;
    const bucket = Math.floor(Date.now() / BUCKET_MS) * BUCKET_MS;
    let last = h.timeline[h.timeline.length - 1];
    if (!last || last[0] !== bucket) {
      last = [bucket, 0, 0];
      h.timeline.push(last);
      if (h.timeline.length > 120) h.timeline.shift();
    }
    if (ok) {
      h.ok++;
      last[1]++;
      h.consecutiveFailures = 0;
      h.openUntil = 0;
    } else {
      h.errors++;
      last[2]++;
      h.consecutiveFailures++;
      if (h.consecutiveFailures >= BREAKER_THRESHOLD) h.openUntil = Date.now() + BREAKER_OPEN_MS;
    }
  }
}

function createProvider(id: ProviderId, env: Env, faults: FaultController): Provider | undefined {
  if (env.DEMO_MODE) return new MockProvider(id, faults, env.MOCK_LATENCY_SCALE);
  const t = env.PROVIDER_TIMEOUT_MS;
  if (id === 'anthropic' && env.ANTHROPIC_API_KEY) return new AnthropicProvider(env.ANTHROPIC_API_KEY, t);
  if (id === 'openai' && env.OPENAI_API_KEY) return new OpenAIProvider(env.OPENAI_API_KEY, t);
  if (id === 'google' && env.GOOGLE_API_KEY) return new GoogleProvider(env.GOOGLE_API_KEY, t);
  return undefined;
}

export function providerOf(model: ModelRef): ProviderId {
  return model.split(':')[0] as ProviderId;
}

export function modelName(model: ModelRef): string {
  return model.slice(model.indexOf(':') + 1);
}
