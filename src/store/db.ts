import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { ROOT_DIR, type TeamConfig } from '../config.js';
import type { LedgerEntry } from '../types.js';

export interface LedgerFilter {
  teamId?: string;
  status?: string;
  since?: string;
  limit?: number;
}

export interface VirtualKey {
  id: string;
  teamId: string;
  label: string;
}

/** Teams, hashed virtual keys and the request ledger. */
export interface Store {
  readonly kind: 'postgres' | 'memory';
  upsertTeams(teams: TeamConfig[]): Promise<void>;
  addKey(teamId: string, rawKey: string, label: string): Promise<VirtualKey>;
  findKey(rawKey: string): Promise<VirtualKey | null>;
  insert(entry: LedgerEntry): Promise<void>;
  list(filter: LedgerFilter): Promise<LedgerEntry[]>;
  monthSpendUsd(teamId: string, monthStartIso: string): Promise<number>;
  clearLedger(): Promise<void>;
  close(): Promise<void>;
}

export function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function generateKey(): string {
  return `gw_${randomBytes(24).toString('base64url')}`;
}

export class MemoryStore implements Store {
  readonly kind = 'memory' as const;
  private keys = new Map<string, VirtualKey>();
  private ledger: LedgerEntry[] = [];

  async upsertTeams() {}

  async addKey(teamId: string, rawKey: string, label: string) {
    const k = { id: `key_${randomUUID().slice(0, 8)}`, teamId, label };
    this.keys.set(hashKey(rawKey), k);
    return k;
  }

  async findKey(rawKey: string) {
    return this.keys.get(hashKey(rawKey)) ?? null;
  }

  async insert(entry: LedgerEntry) {
    this.ledger.push(entry);
    if (this.ledger.length > 100_000) this.ledger.shift();
  }

  async list(f: LedgerFilter) {
    let rows = this.ledger;
    if (f.since) rows = rows.filter((r) => r.ts >= f.since!);
    if (f.teamId) rows = rows.filter((r) => r.teamId === f.teamId);
    if (f.status) rows = rows.filter((r) => r.status === f.status);
    const out = rows.slice().reverse();
    return f.limit ? out.slice(0, f.limit) : out;
  }

  async monthSpendUsd(teamId: string, monthStartIso: string) {
    return this.ledger.filter((r) => r.teamId === teamId && r.ts >= monthStartIso).reduce((a, r) => a + r.costUsd, 0);
  }

  async clearLedger() {
    this.ledger = [];
  }

  async close() {}
}

export class PostgresStore implements Store {
  readonly kind = 'postgres' as const;
  constructor(private pool: pg.Pool) {}

  static async connect(url: string): Promise<PostgresStore> {
    const pool = new pg.Pool({ connectionString: url, max: 10 });
    await pool.query(readFileSync(path.join(ROOT_DIR, 'src', 'store', 'schema.sql'), 'utf8'));
    return new PostgresStore(pool);
  }

  async upsertTeams(teams: TeamConfig[]) {
    for (const t of teams) {
      await this.pool.query(
        `INSERT INTO teams (id, name, monthly_budget_usd, rpm_limit, allowed_models, default_model, pii_mode, pii_block_types, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
         ON CONFLICT (id) DO UPDATE SET name=$2, monthly_budget_usd=$3, rpm_limit=$4, allowed_models=$5, default_model=$6, pii_mode=$7, pii_block_types=$8, updated_at=now()`,
        [t.id, t.name, t.monthlyBudgetUsd, t.rpmLimit, t.allowedModels, t.defaultModel, t.pii.mode, t.pii.blockTypes],
      );
    }
  }

  async addKey(teamId: string, rawKey: string, label: string) {
    const id = `key_${randomUUID().slice(0, 8)}`;
    await this.pool.query(
      `INSERT INTO virtual_keys (id, team_id, key_hash, label) VALUES ($1,$2,$3,$4) ON CONFLICT (key_hash) DO NOTHING`,
      [id, teamId, hashKey(rawKey), label],
    );
    return (await this.findKey(rawKey))!;
  }

  async findKey(rawKey: string) {
    const r = await this.pool.query(`SELECT id, team_id, label FROM virtual_keys WHERE key_hash=$1 AND revoked_at IS NULL`, [hashKey(rawKey)]);
    const row = r.rows[0];
    return row ? { id: row.id, teamId: row.team_id, label: row.label } : null;
  }

  async insert(e: LedgerEntry) {
    await this.pool.query(
      `INSERT INTO requests (id, ts, team_id, key_id, endpoint, requested_model, routed_model, route_rule, task, input_tokens, output_tokens,
        cost_usd, baseline_model, baseline_cost_usd, saved_usd, cache, redactions, policy, status, http_status, attempts, fallback_used, latency_ms, redacted_prompt)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
      [e.id, e.ts, e.teamId, e.keyId, e.endpoint, e.requestedModel, e.routedModel, e.routeRule, e.task, e.inputTokens, e.outputTokens,
        e.costUsd, e.baselineModel, e.baselineCostUsd, e.savedUsd, e.cache, JSON.stringify(e.redactions), JSON.stringify(e.policy), e.status,
        e.httpStatus, JSON.stringify(e.attempts), e.fallbackUsed, e.latencyMs, e.redactedPrompt ?? null],
    );
  }

  async list(f: LedgerFilter) {
    const where: string[] = [];
    const args: unknown[] = [];
    if (f.since) where.push(`ts >= $${args.push(f.since)}`);
    if (f.teamId) where.push(`team_id = $${args.push(f.teamId)}`);
    if (f.status) where.push(`status = $${args.push(f.status)}`);
    const sql = `SELECT * FROM requests ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ts DESC ${f.limit ? `LIMIT ${Number(f.limit)}` : ''}`;
    const r = await this.pool.query(sql, args);
    return r.rows.map(fromRow);
  }

  async monthSpendUsd(teamId: string, monthStartIso: string) {
    const r = await this.pool.query(`SELECT COALESCE(SUM(cost_usd),0) AS s FROM requests WHERE team_id=$1 AND ts >= $2`, [teamId, monthStartIso]);
    return Number(r.rows[0].s);
  }

  async clearLedger() {
    await this.pool.query('TRUNCATE requests');
  }

  async close() {
    await this.pool.end();
  }
}

function fromRow(r: Record<string, any>): LedgerEntry {
  return {
    id: r.id,
    ts: new Date(r.ts).toISOString(),
    teamId: r.team_id,
    keyId: r.key_id,
    endpoint: r.endpoint,
    requestedModel: r.requested_model,
    routedModel: r.routed_model,
    routeRule: r.route_rule,
    task: r.task,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    costUsd: Number(r.cost_usd),
    baselineModel: r.baseline_model,
    baselineCostUsd: Number(r.baseline_cost_usd),
    savedUsd: Number(r.saved_usd),
    cache: r.cache,
    redactions: r.redactions,
    policy: r.policy,
    status: r.status,
    httpStatus: r.http_status,
    attempts: r.attempts,
    fallbackUsed: r.fallback_used,
    latencyMs: r.latency_ms,
    ...(r.redacted_prompt ? { redactedPrompt: r.redacted_prompt } : {}),
  };
}
