import Fastify, { type FastifyInstance } from 'fastify';
import type { DestinationStream } from 'pino';
import { loadConfig, loadEnv, type Env, type GatewayConfig } from './config.js';
import { Gateway } from './pipeline.js';
import { ProviderRegistry } from './providers/registry.js';
import type { Provider } from './providers/types.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerAnthropicRoutes } from './routes/anthropic.js';
import { registerOpenAIRoutes } from './routes/openai.js';
import { MemoryStore, PostgresStore, type Store } from './store/db.js';
import { MemoryKV, RedisKV, type KV } from './store/kv.js';
import type { ProviderId } from './types.js';

export interface BuildOptions {
  env?: Env;
  config?: GatewayConfig;
  configDir?: string;
  providers?: Partial<Record<ProviderId, Provider>>;
  kv?: KV;
  store?: Store;
  /** Where logs go (tests capture this to prove no personal data is logged). */
  logStream?: DestinationStream;
}

async function connectKV(env: Env, warn: (m: string) => void): Promise<KV> {
  if (!env.REDIS_URL) return new MemoryKV();
  try {
    return await RedisKV.connect(env.REDIS_URL);
  } catch (err) {
    if (!env.DEMO_MODE) throw err;
    warn(`Redis unavailable (${(err as Error).message}); using in-memory store for demo mode`);
    return new MemoryKV();
  }
}

async function connectStore(env: Env, warn: (m: string) => void): Promise<Store> {
  if (!env.DATABASE_URL) return new MemoryStore();
  try {
    return await PostgresStore.connect(env.DATABASE_URL);
  } catch (err) {
    if (!env.DEMO_MODE) throw err;
    warn(`Postgres unavailable (${(err as Error).message}); using in-memory ledger for demo mode`);
    return new MemoryStore();
  }
}

export async function buildApp(opts: BuildOptions = {}): Promise<{ app: FastifyInstance; gw: Gateway }> {
  const env = opts.env ?? loadEnv();
  const cfg = opts.config ?? loadConfig(opts.configDir);
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // Request bodies are never logged. Credentials are masked if a header is ever logged.
      redact: ['req.headers.authorization', 'req.headers["x-api-key"]'],
      ...(opts.logStream ? { stream: opts.logStream } : {}),
    },
    disableRequestLogging: true,
    bodyLimit: 2 * 1024 * 1024,
  });
  const warn = (m: string) => app.log.warn(m);
  const kv = opts.kv ?? (await connectKV(env, warn));
  const store = opts.store ?? (await connectStore(env, warn));
  const providers = new ProviderRegistry(env, opts.providers);
  const gw = new Gateway(env, cfg, providers, kv, store);

  await store.upsertTeams(cfg.teams);
  if (env.DEMO_MODE) {
    for (const t of cfg.teams) if (t.demoKey) await store.addKey(t.id, t.demoKey, 'demo');
  }
  await gw.budget.syncFromLedger(cfg.teams);

  app.addHook('onResponse', async (req, reply) => {
    if (req.url.startsWith('/admin/summary') || req.url === '/health') return;
    app.log.info({ method: req.method, url: req.url.split('?')[0], status: reply.statusCode, ms: Math.round(reply.elapsedTime), requestId: reply.getHeader('x-gateway-request-id') }, 'request');
  });

  app.get('/health', async () => ({ ok: true, demoMode: env.DEMO_MODE, cache: kv.kind, ledger: store.kind, providers: providers.status().map((p) => ({ id: p.id, configured: p.configured, mock: p.mock })) }));

  registerOpenAIRoutes(app, gw);
  registerAnthropicRoutes(app, gw);
  registerAdminRoutes(app, gw, opts.configDir);

  app.addHook('onClose', async () => {
    await kv.close();
    await store.close();
  });
  return { app, gw };
}
