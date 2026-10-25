import type { GatewayConfig, Rule } from '../config.js';
import { blendedPrice } from '../pricing.js';
import type { ModelRef, Task, Team } from '../types.js';

export interface RouteDecision {
  /** Ordered chain: first is the primary, the rest are fallbacks. */
  chain: ModelRef[];
  rule: string;
  tier: 'small' | 'large' | 'cheapest' | 'explicit';
}

export interface RouteInput {
  requestedModel: string;
  team: Team;
  task: Task;
  inputTokens: number;
  text: string;
}

export class Router {
  constructor(private cfg: GatewayConfig) {}

  setConfig(cfg: GatewayConfig): void {
    this.cfg = cfg;
  }

  decide(input: RouteInput): RouteDecision {
    const requested = input.requestedModel.trim();
    if (requested === 'auto' || requested === '') {
      const rule = this.cfg.routing.rules.find((r) => matches(r, input));
      return this.resolveTarget(rule?.route ?? this.cfg.routing.default, rule?.name ?? 'default');
    }
    if (requested === 'small' || requested === 'large' || requested === 'cheapest') {
      return this.resolveTarget(requested, `alias:${requested}`);
    }
    return this.resolveTarget(this.normaliseModel(requested), 'explicit-model');
  }

  /** Accepts "provider:model" or a bare model id like "gpt-4.1-mini". */
  normaliseModel(model: string): ModelRef {
    if (/^(openai|anthropic|google):/.test(model)) return model as ModelRef;
    const known = Object.keys(this.cfg.prices.models) as ModelRef[];
    return known.find((m) => m.endsWith(`:${model}`)) ?? (`openai:${model}` as ModelRef);
  }

  resolveTarget(target: string, rule: string): RouteDecision {
    const { tiers, equivalents } = this.cfg.models;
    if (target === 'small' || target === 'large') return { chain: [...tiers[target]], rule, tier: target };
    if (target === 'cheapest') {
      const all = uniq([...tiers.small, ...tiers.large]).sort((a, b) => blendedPrice(this.cfg.prices, a) - blendedPrice(this.cfg.prices, b));
      return { chain: all.slice(0, 3), rule, tier: 'cheapest' };
    }
    const model = this.normaliseModel(target);
    return { chain: uniq([model, ...(equivalents[model] ?? [])]), rule, tier: 'explicit' };
  }
}

function matches(rule: Rule, input: RouteInput): boolean {
  const w = rule.when;
  if (w.team !== undefined) {
    const teams = (Array.isArray(w.team) ? w.team : [w.team]).map((t) => t.toLowerCase());
    if (!teams.includes(input.team.id.toLowerCase()) && !teams.includes(input.team.name.toLowerCase())) return false;
  }
  if (w.task && !w.task.includes(input.task)) return false;
  if (w.minInputTokens !== undefined && input.inputTokens < w.minInputTokens) return false;
  if (w.maxInputTokens !== undefined && input.inputTokens > w.maxInputTokens) return false;
  if (w.contains && !w.contains.some((k) => input.text.toLowerCase().includes(k.toLowerCase()))) return false;
  return true;
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}
