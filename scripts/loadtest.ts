/**
 * npm run loadtest: measures what the gateway itself adds per request.
 * Boots its own gateway in demo mode with an instant mock provider and no rate limit,
 * so the measured latency is only the gateway (auth, redaction, routing, budget, ledger).
 */
import autocannon from 'autocannon';
import { buildApp } from '../src/app.js';
import { loadConfig, loadEnv } from '../src/config.js';

const config = loadConfig();
for (const t of config.teams) {
  t.rpmLimit = 1_000_000;
  t.monthlyBudgetUsd = 1_000_000;
}
const { app } = await buildApp({ env: loadEnv({ DEMO_MODE: '1', MOCK_LATENCY_SCALE: '0', LOG_LEVEL: 'warn' }), config });
const url = await app.listen({ port: 0, host: '127.0.0.1' });

let i = 0;
const body = () =>
  JSON.stringify({ model: 'auto', messages: [{ role: 'user', content: `Classify this ticket ${i++}: charged twice, email jane.doe@example.com, card 4111 1111 1111 1111` }] });

const result = await autocannon({
  url: `${url}/v1/chat/completions`,
  method: 'POST',
  connections: 10,
  duration: Number(process.env.LOADTEST_SECONDS ?? 10),
  headers: { 'content-type': 'application/json', authorization: 'Bearer demo-key-data' },
  requests: [{ setupRequest: (req) => ({ ...req, body: body() }) }],
});
console.log(`gateway only (mock provider answers instantly), 10 connections:`);
console.log(`  ${Math.round(result.requests.average)} requests/s | latency p50 ${result.latency.p50} ms, p99 ${result.latency.p99} ms | errors ${result.non2xx + result.errors}`);
await app.close();
