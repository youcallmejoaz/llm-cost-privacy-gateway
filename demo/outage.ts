/**
 * npm run demo:outage: simulates an outage at the primary provider and shows
 * what the apps experience. Demo mode only.
 */
import { admin, SAMPLES, send, waitForGateway } from './client.js';

const provider = process.argv[2] ?? 'anthropic';
const n = Number(process.argv[3] ?? 12);
await waitForGateway();

console.log(`Simulating outage: ${provider} returns 503 for every call\n`);
await admin(`/admin/providers/${provider}/fault`, { mode: 'error' });
const picks = SAMPLES.filter((s) => s.team !== 'marketing').slice(0, n);
let ok = 0;
try {
  for (const s of picks) {
    const started = Date.now();
    const { status, json } = await send(s.team, s.body, { 'x-gateway-cache': 'off' });
    const g = json.gateway ?? {};
    if (status === 200) ok++;
    const path = status === 200 ? `${g.fallback ? 'fallback to ' : ''}${g.model}` : json.error?.message;
    console.log(`${String(status).padEnd(4)} ${s.team.padEnd(8)} ${String(Date.now() - started).padStart(5)} ms  ${path}`);
  }
} finally {
  await admin(`/admin/providers/${provider}/fault`, { mode: 'none' });
}
console.log(`\n${ok} of ${picks.length} requests succeeded for the apps. ${provider} restored.`);
