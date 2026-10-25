/**
 * npm run seed: resets the demo gateway and replays the 200 sample requests
 * from Support, Marketing and Data. Use --no-reset to add traffic on top.
 */
import { admin, SAMPLES, send, waitForGateway } from './client.js';

const reset = !process.argv.includes('--no-reset');
const concurrency = Number(process.env.SEED_CONCURRENCY ?? 6);

await waitForGateway();
const cfg = await admin('/admin/config');
if (reset) {
  if (!cfg.demoMode) throw new Error('Refusing to reset: gateway is not in demo mode. Use --no-reset.');
  await admin('/admin/reset', {});
}

const counts: Record<string, number> = {};
let next = 0;
async function worker() {
  while (next < SAMPLES.length) {
    const s = SAMPLES[next++];
    const { status, json } = await send(s.team, s.body);
    const key = status === 200 ? `ok${json.gateway?.cache === 'exact' ? ' (cache)' : ''}` : `${status} ${json.error?.type}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));

const sum = await admin('/admin/summary');
const t = sum.totals;
console.log(`sent ${SAMPLES.length} requests:`, counts);
console.log(`spend $${t.spendUsd.toFixed(4)} | without routing and cache $${t.baselineUsd.toFixed(4)} | saved $${t.savedUsd.toFixed(4)} (routing $${t.savedRoutingUsd.toFixed(4)}, cache $${t.savedCacheUsd.toFixed(4)})`);
console.log(`redactions ${t.redactions} | cache hits ${t.cacheHits} | blocked by budget ${t.blockedBudget} | blocked by PII policy ${t.blockedPii}`);
for (const team of sum.teams) console.log(`  ${team.name.padEnd(10)} spent $${team.budgetUsedUsd.toFixed(4)} of $${team.budgetUsd.toFixed(2)}`);
