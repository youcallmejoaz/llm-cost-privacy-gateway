import { afterAll, describe, expect, it } from 'vitest';
import { PostgresStore } from '../src/store/db.js';
import { RedisKV } from '../src/store/kv.js';
import { testApp } from './helpers.js';

// Runs against real services when TEST_DATABASE_URL and TEST_REDIS_URL are set (CI starts both).
const dbUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;

describe.skipIf(!dbUrl || !redisUrl)('Postgres ledger and Redis counters', () => {
  const cleanup: Array<() => Promise<void>> = [];
  afterAll(async () => {
    for (const c of cleanup) await c();
  });

  it('runs the full pipeline on Postgres + Redis and survives a restart', async () => {
    const store = await PostgresStore.connect(dbUrl!);
    const kv = await RedisKV.connect(redisUrl!);
    await store.clearLedger();
    await kv.deletePrefix('');
    const ctx = await testApp({ store, kv });
    const body = { model: 'auto', messages: [{ role: 'user', content: 'Summarise: jane.doe@example.com lost order ORD-40001' }] };
    expect((await ctx.chat('support', body)).headers['x-gateway-cache']).toBe('miss');
    expect((await ctx.chat('support', body)).headers['x-gateway-cache']).toBe('exact');
    const rows = await store.list({ teamId: 'support' });
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows)).not.toContain('jane.doe');
    const spent = await store.monthSpendUsd('support', '2000-01-01T00:00:00.000Z');
    expect(spent).toBeCloseTo(rows[1].costUsd, 6);
    expect(await ctx.gw.budget.spentUsd('support')).toBeCloseTo(spent, 6);
    await ctx.app.close();

    // Redis counter lost: it is rebuilt from the Postgres ledger at start.
    const store2 = await PostgresStore.connect(dbUrl!);
    const kv2 = await RedisKV.connect(redisUrl!);
    await kv2.deletePrefix('spend:');
    const ctx2 = await testApp({ store: store2, kv: kv2 });
    expect(await ctx2.gw.budget.spentUsd('support')).toBeCloseTo(spent, 6);
    cleanup.push(() => ctx2.app.close());
  });
});
