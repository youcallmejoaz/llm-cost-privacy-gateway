import { watch } from 'node:fs';
import path from 'node:path';
import { buildApp } from './app.js';
import { loadConfig, loadEnv, ROOT_DIR } from './config.js';

const env = loadEnv();
const configDir = env.CONFIG_DIR ?? path.join(ROOT_DIR, 'config');
const { app, gw } = await buildApp({ env, configDir });

// Routing rules, prices and teams are data: edits to config/*.json apply without a restart.
let timer: NodeJS.Timeout | undefined;
watch(configDir, () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      gw.setConfig(loadConfig(configDir));
      app.log.info({ rules: gw.cfg.routing.rules.map((r) => r.name) }, 'config reloaded');
    } catch (err) {
      app.log.error(`config not reloaded, keeping previous version: ${(err as Error).message}`);
    }
  }, 200);
});

await app.listen({ port: env.PORT, host: env.HOST });
app.log.info(`gateway ready on :${env.PORT} (demo mode: ${env.DEMO_MODE ? 'on, no API keys needed' : 'off'})`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await app.close();
    process.exit(0);
  });
}
