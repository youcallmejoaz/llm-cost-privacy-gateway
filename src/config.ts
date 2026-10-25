import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { ModelRef, PiiType, Team } from './types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// Works from src/ (tsx) and dist/src/ (compiled).
export const ROOT_DIR = [path.resolve(here, '..'), path.resolve(here, '../..')].find((d) => {
  try {
    readFileSync(path.join(d, 'config', 'prices.json'));
    return true;
  } catch {
    return false;
  }
}) ?? path.resolve(here, '..');

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v === '1' || v.toLowerCase() === 'true'));

const EnvSchema = z.object({
  DEMO_MODE: bool(true),
  PORT: z.coerce.number().default(8787),
  HOST: z.string().default('0.0.0.0'),
  ADMIN_TOKEN: z.string().optional(),
  REDIS_URL: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
  PROVIDER_TIMEOUT_MS: z.coerce.number().default(20000),
  CACHE_TTL_SECONDS: z.coerce.number().default(86400),
  CACHE_SCOPE: z.enum(['team', 'global']).default('team'),
  SEMANTIC_CACHE: bool(false),
  SEMANTIC_CACHE_THRESHOLD: z.coerce.number().default(0.92),
  CLASSIFIER: z.enum(['rules', 'llm']).optional(),
  AUDIT_STORE_REDACTED_PROMPTS: bool(false),
  MOCK_LATENCY_SCALE: z.coerce.number().default(1),
  LOG_LEVEL: z.string().default('info'),
  CONFIG_DIR: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const env = EnvSchema.parse(source);
  if (!env.DEMO_MODE && !env.ADMIN_TOKEN) {
    throw new Error('ADMIN_TOKEN is required when DEMO_MODE=0');
  }
  return env;
}

const modelRef = z.string().regex(/^(openai|anthropic|google):.+$/) as unknown as z.ZodType<ModelRef>;
const piiType = z.enum(['email', 'phone', 'ni_number', 'card', 'iban', 'postcode']) as z.ZodType<PiiType>;

const PricesSchema = z.object({
  _label: z.string(),
  models: z.record(z.string(), z.object({ input: z.number().nonnegative(), output: z.number().nonnegative() })),
});

const ModelsSchema = z.object({
  tiers: z.object({ small: z.array(modelRef).min(1), large: z.array(modelRef).min(1) }),
  equivalents: z.record(z.string(), z.union([z.array(modelRef), z.string()])),
});

export const RuleSchema = z.object({
  name: z.string(),
  when: z
    .object({
      team: z.union([z.string(), z.array(z.string())]).optional(),
      task: z.array(z.enum(['classification', 'extraction', 'summary', 'draft', 'analysis', 'chat'])).optional(),
      minInputTokens: z.number().optional(),
      maxInputTokens: z.number().optional(),
      contains: z.array(z.string()).optional(),
    })
    .default({}),
  route: z.string(),
});

const RoutingSchema = z.object({
  classifier: z.enum(['rules', 'llm']).default('rules'),
  rules: z.array(RuleSchema),
  default: z.string().default('large'),
});

const TeamsSchema = z.object({
  teams: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      monthlyBudgetUsd: z.number().nonnegative(),
      rpmLimit: z.number().int().positive(),
      allowedModels: z.array(z.string()),
      defaultModel: modelRef,
      pii: z.object({ mode: z.enum(['redact', 'block', 'off']), blockTypes: z.array(piiType).default([]) }),
      demoKey: z.string().optional(),
    }),
  ),
});

export type Prices = z.infer<typeof PricesSchema>;
export type Rule = z.infer<typeof RuleSchema>;
export type RoutingConfig = z.infer<typeof RoutingSchema>;
export interface ModelsConfig {
  tiers: { small: ModelRef[]; large: ModelRef[] };
  equivalents: Record<string, ModelRef[]>;
}
export interface TeamConfig extends Team {
  demoKey?: string;
}

export interface GatewayConfig {
  prices: Prices;
  models: ModelsConfig;
  routing: RoutingConfig;
  teams: TeamConfig[];
}

function readJson(dir: string, file: string): unknown {
  return JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
}

export function loadConfig(dir = path.join(ROOT_DIR, 'config')): GatewayConfig {
  const prices = PricesSchema.parse(readJson(dir, 'prices.json'));
  const rawModels = ModelsSchema.parse(readJson(dir, 'models.json'));
  const equivalents: Record<string, ModelRef[]> = {};
  for (const [k, v] of Object.entries(rawModels.equivalents)) {
    if (Array.isArray(v)) equivalents[k] = v;
  }
  const routing = parseRouting(readJson(dir, 'routing.json'));
  const teams = TeamsSchema.parse(readJson(dir, 'teams.json')).teams;
  const cfg: GatewayConfig = { prices, models: { tiers: rawModels.tiers, equivalents }, routing, teams };
  validateConfig(cfg);
  return cfg;
}

export function parseRouting(raw: unknown): RoutingConfig {
  return RoutingSchema.parse(raw);
}

/** Every model the gateway can route to must have a price, so the ledger never guesses. */
export function validateConfig(cfg: GatewayConfig): void {
  const all = new Set<string>([...cfg.models.tiers.small, ...cfg.models.tiers.large]);
  for (const list of Object.values(cfg.models.equivalents)) list.forEach((m) => all.add(m));
  for (const t of cfg.teams) all.add(t.defaultModel);
  for (const r of cfg.routing.rules) if (r.route.includes(':')) all.add(r.route);
  const missing = [...all].filter((m) => !cfg.prices.models[m]);
  if (missing.length) throw new Error(`No price in config/prices.json for: ${missing.join(', ')}`);
}
