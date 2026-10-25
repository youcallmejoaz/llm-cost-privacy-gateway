import { toMicro } from './pricing.js';
import type { Store } from './store/db.js';
import type { KV } from './store/kv.js';
import type { Team } from './types.js';

export function monthKey(d = new Date()): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthStartIso(d = new Date()): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

const MONTH_TTL = 40 * 24 * 3600;

/**
 * Budgets are enforced before the provider is called: the estimated cost is
 * reserved atomically, and the request is refused if the reservation would
 * take the team over its monthly budget. After the call the reservation is
 * corrected to the real cost.
 */
export class BudgetGuard {
  constructor(private kv: KV, private store: Store) {}

  private key(teamId: string) {
    return `spend:${teamId}:${monthKey()}`;
  }

  /** Rebuild counters from the ledger (source of truth) when the counter is missing. */
  async syncFromLedger(teams: Team[]): Promise<void> {
    for (const t of teams) {
      if ((await this.kv.get(this.key(t.id))) !== null) continue;
      const spent = await this.store.monthSpendUsd(t.id, monthStartIso());
      await this.kv.set(this.key(t.id), String(toMicro(spent)), MONTH_TTL);
    }
  }

  async spentUsd(teamId: string): Promise<number> {
    return Number((await this.kv.get(this.key(teamId))) ?? 0) / 1_000_000;
  }

  async reserve(team: Team, estimateUsd: number): Promise<{ ok: boolean; reservedMicro: number; spentUsd: number }> {
    const est = Math.max(1, toMicro(estimateUsd));
    const after = await this.kv.incrBy(this.key(team.id), est, MONTH_TTL);
    if (after > toMicro(team.monthlyBudgetUsd)) {
      await this.kv.incrBy(this.key(team.id), -est);
      return { ok: false, reservedMicro: 0, spentUsd: (after - est) / 1_000_000 };
    }
    return { ok: true, reservedMicro: est, spentUsd: after / 1_000_000 };
  }

  async settle(teamId: string, reservedMicro: number, actualUsd: number): Promise<void> {
    const delta = toMicro(actualUsd) - reservedMicro;
    if (delta !== 0) await this.kv.incrBy(this.key(teamId), delta, MONTH_TTL);
  }

  async reset(teams: Team[]): Promise<void> {
    for (const t of teams) await this.kv.set(this.key(t.id), '0', MONTH_TTL);
  }
}

export class RateLimiter {
  constructor(private kv: KV) {}

  /** Fixed one minute window per virtual key. */
  async hit(keyId: string, limit: number): Promise<{ ok: boolean; retryAfterSeconds: number }> {
    const now = Date.now();
    const minute = Math.floor(now / 60_000);
    const count = await this.kv.incrBy(`rl:${keyId}:${minute}`, 1, 70);
    return { ok: count <= limit, retryAfterSeconds: Math.ceil(((minute + 1) * 60_000 - now) / 1000) };
  }
}
