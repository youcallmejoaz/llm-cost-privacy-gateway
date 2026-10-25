/** npm run keys:create -- <teamId> [label]: issues a virtual key for a team (shown once). */
import { admin } from '../demo/client.js';

const [teamId, label = 'api'] = process.argv.slice(2);
if (!teamId) {
  console.error('usage: npm run keys:create -- <teamId> [label]');
  process.exit(1);
}
const res = await admin('/admin/keys', { teamId, label });
console.log(`Key for ${res.teamId} (${res.id}): ${res.key}\n${res.note}`);
