import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { loadConfig } from '../config.js';
import { Redactor } from '../pii/redactor.js';
import type { Gateway } from '../pipeline.js';
import { PROVIDER_IDS } from '../providers/registry.js';
import { generateKey } from '../store/db.js';
import { buildSummary, publicRow } from '../summary.js';
import type { ProviderId } from '../types.js';

/** Demo mode only: a placeholder so the local dashboard works with zero setup. Not a secret. */
export const DEMO_ADMIN_TOKEN = 'demo-admin';

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function registerAdminRoutes(app: FastifyInstance, gw: Gateway, configDir?: string): void {
  const token = gw.env.ADMIN_TOKEN ?? (gw.env.DEMO_MODE ? DEMO_ADMIN_TOKEN : undefined);

  app.register(async (admin) => {
    admin.addHook('onRequest', async (req, reply) => {
      const h = req.headers.authorization ?? '';
      const given = h.toLowerCase().startsWith('bearer ') ? h.slice(7) : '';
      if (!token || !safeEqual(given, token)) return reply.code(401).send({ error: 'admin token required' });
    });

    admin.get('/admin/summary', async () => buildSummary(gw));

    admin.get('/admin/requests', async (req) => {
      const q = z
        .object({ team: z.string().optional(), status: z.string().optional(), limit: z.coerce.number().max(1000).default(100) })
        .parse(req.query);
      const rows = await gw.store.list({ teamId: q.team || undefined, status: q.status || undefined, limit: q.limit });
      return { rows: rows.map(publicRow) };
    });

    admin.get('/admin/config', async () => ({
      demoMode: gw.env.DEMO_MODE,
      stores: { cache: gw.kv.kind, ledger: gw.store.kind },
      prices: gw.cfg.prices,
      tiers: gw.cfg.models.tiers,
      routing: gw.cfg.routing,
      teams: gw.teamList().map(({ demoKey: _k, ...t }) => t),
      semanticCache: Boolean(gw.semantic),
    }));

    admin.post('/admin/config/reload', async (_req, reply) => {
      try {
        gw.setConfig(loadConfig(configDir));
        return { ok: true, rules: gw.cfg.routing.rules.map((r) => r.name) };
      } catch (err) {
        return reply.code(400).send({ ok: false, error: (err as Error).message });
      }
    });

    admin.post('/admin/keys', async (req, reply) => {
      const b = z.object({ teamId: z.string(), label: z.string().default('api') }).parse(req.body);
      if (!gw.team(b.teamId)) return reply.code(404).send({ error: 'unknown team' });
      const raw = generateKey();
      const k = await gw.store.addKey(b.teamId, raw, b.label);
      return { id: k.id, teamId: k.teamId, key: raw, note: 'Shown once. Store it in your secret manager.' };
    });

    admin.get('/admin/providers', async () => ({ providers: gw.providers.status() }));

    admin.post('/admin/providers/:id/fault', async (req, reply) => {
      const id = (req.params as { id: string }).id as ProviderId;
      if (!PROVIDER_IDS.includes(id)) return reply.code(404).send({ error: 'unknown provider' });
      const b = z.object({ mode: z.enum(['none', 'error', 'timeout']) }).parse(req.body);
      if (!gw.env.DEMO_MODE) return reply.code(400).send({ error: 'Outage simulation is only available in demo mode.' });
      gw.providers.faults.set(id, b.mode);
      return { ok: true, provider: id, mode: b.mode };
    });

    // Preview only: nothing here is stored or logged.
    admin.post('/admin/redact-preview', async (req) => {
      const b = z.object({ text: z.string().max(20000) }).parse(req.body);
      const r = new Redactor();
      const out = r.redact(b.text);
      return { redacted: out.text, findings: out.findings.map(({ type, token }) => ({ type, token })), counts: r.counts };
    });

    admin.post('/admin/reset', async (_req, reply) => {
      if (!gw.env.DEMO_MODE) return reply.code(400).send({ error: 'Reset is only available in demo mode.' });
      await gw.store.clearLedger();
      await gw.cache.clear();
      gw.semantic?.clear();
      await gw.budget.reset(gw.teamList());
      await gw.kv.deletePrefix('rl:');
      gw.providers.faults.clear();
      gw.providers.resetHealth();
      return { ok: true };
    });
  });
}
