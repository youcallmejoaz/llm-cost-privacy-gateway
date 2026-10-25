/**
 * Records every clip for the video in demo mode, so results are repeatable.
 *
 *   node clips/record.mjs                 # start gateway + dashboard, record all, convert to MP4
 *   node clips/record.mjs --only C04,K02  # just these clips
 *   node clips/record.mjs --no-start      # use a gateway (:8787) and dashboard (:3000) you started yourself
 *
 * UI clips are scripted user actions at 1920x1080 with a visible cursor and a ring on every click,
 * a 600 to 900 ms pause after each action and typing at about 12 characters per second.
 * Needs a built dashboard (npm run build -w dashboard) and ffmpeg on the PATH.
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const RAW = path.join(HERE, 'raw');
const GATEWAY = 'http://localhost:8787';
const DASH = 'http://localhost:3000';
const ADMIN = { authorization: 'Bearer demo-admin', 'content-type': 'application/json' };
const CURSOR = readFileSync(path.join(HERE, 'lib', 'cursor.js'), 'utf8');

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const want = (id) => !only || only.includes(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const children = [];

mkdirSync(RAW, { recursive: true });

// ---------- servers and demo data ----------

async function waitFor(url, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await sleep(300);
  }
  throw new Error(`timeout waiting for ${url}`);
}

function start(cmd, argv, cwd, env = {}) {
  const p = spawn(cmd, argv, { cwd, env: { ...process.env, ...env }, stdio: 'ignore' });
  children.push(p);
  return p;
}

async function admin(p, body) {
  const res = await fetch(GATEWAY + p, { method: body ? 'POST' : 'GET', headers: ADMIN, body: body ? JSON.stringify(body) : undefined });
  return res.json();
}

async function chat(team, content, maxTokens = 600) {
  const res = await fetch(`${GATEWAY}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer demo-key-${team}` },
    body: JSON.stringify({ model: 'auto', max_tokens: maxTokens, messages: [{ role: 'user', content }] }),
  });
  return res.status;
}

function seed(reset = true) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['--import', 'tsx', 'demo/seed.ts', ...(reset ? [] : ['--no-reset'])], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, SEED_CONCURRENCY: '4' } });
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`seed exited ${code}`))));
  });
}

// ---------- recording helpers ----------

const recorded = [];

async function scene(id, fn, opts = {}) {
  if (!want(id)) return;
  const scale = opts.scale ?? 1;
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: scale,
    recordVideo: { dir: RAW, size: { width: 1920 * scale, height: 1080 * scale } },
  });
  if (opts.cursor !== false) await context.addInitScript(CURSOR);
  const page = await context.newPage();
  const t0 = Date.now();
  let tStart = t0;
  const s = makeHelpers(page);
  s.mark = async () => {
    await page.mouse.move(s.pos.x, s.pos.y);
    await sleep(400);
    tStart = Date.now();
  };
  console.log(`recording ${id}`);
  await fn(page, s);
  const tEnd = Date.now();
  const video = page.video();
  await context.close();
  await browser.close();
  const raw = path.join(RAW, `${id}.webm`);
  renameSync(await video.path(), raw);
  recorded.push({ id, raw, ss: (tStart - t0) / 1000, dur: (tEnd - tStart) / 1000, scale, crop: s.crop, file: opts.file });
}

async function closeUp(id, fn, region, file) {
  if (!want('C03')) return;
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
  await context.addInitScript(CURSOR);
  const page = await context.newPage();
  const s = makeHelpers(page);
  const dir = path.join(RAW, id);
  mkdirSync(dir, { recursive: true });
  let clip = null;
  let capturing = false;
  const frames = [];
  let loop = Promise.resolve();
  s.beforeActions = async (row) => {
    clip = await region(row);
  };
  s.mark = async () => {
    await page.mouse.move(s.pos.x, s.pos.y);
    capturing = true;
    loop = (async () => {
      while (capturing) {
        const t = Date.now();
        const buf = await page.screenshot({ clip, type: 'png' });
        frames.push({ t, buf });
      }
    })();
    await sleep(300);
  };
  console.log(`recording ${id} (screenshots at 2x)`);
  await fn(page, s);
  capturing = false;
  await loop;
  await browser.close();
  const { writeFileSync } = await import('node:fs');
  // ffconcat with real frame timings, so motion plays back at the speed it happened.
  let list = 'ffconcat version 1.0\n';
  frames.forEach((f, i) => {
    const name = `f${String(i).padStart(5, '0')}.png`;
    writeFileSync(path.join(dir, name), f.buf);
    const next = frames[i + 1]?.t ?? f.t + 33;
    list += `file '${name}'\nduration ${((next - f.t) / 1000).toFixed(3)}\n`;
  });
  writeFileSync(path.join(dir, 'list.txt'), list);
  recorded.push({ id, concat: path.join(dir, 'list.txt'), file, dur: (frames.at(-1).t - frames[0].t) / 1000 });
}

function makeHelpers(page) {
  const s = {
    pos: { x: 1100, y: 640 },
    crop: null,
    pause: (ms = 750) => sleep(ms),
    async moveTo(target, { dx = 0, dy = 0 } = {}) {
      const loc = typeof target === 'string' ? page.locator(target).first() : target;
      await loc.scrollIntoViewIfNeeded();
      const box = await loc.boundingBox();
      const x = box.x + box.width / 2 + dx;
      const y = box.y + box.height / 2 + dy;
      const dist = Math.hypot(x - s.pos.x, y - s.pos.y);
      await page.mouse.move(x, y, { steps: Math.max(12, Math.round(dist / 14)) });
      s.pos = { x, y };
    },
    async click(target, pauseMs = 750) {
      await s.moveTo(target);
      await sleep(180);
      await page.mouse.down();
      await sleep(70);
      await page.mouse.up();
      await sleep(pauseMs);
    },
    async type(text, cps = 12) {
      await page.keyboard.type(text, { delay: Math.round(1000 / cps) });
      await sleep(700);
    },
    async select(target, value) {
      await s.click(target, 250);
      await page.locator(typeof target === 'string' ? target : '').first().selectOption(value);
      await sleep(700);
    },
    async ready(url) {
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.waitForTimeout(900);
    },
  };
  return s;
}

// ---------- the UI scenes ----------

async function uiScenes() {
  await admin('/admin/reset', {});

  await scene('C01', async (page, s) => {
    await s.ready(`${DASH}/client`);
    await s.mark();
    await s.moveTo('#live');
    await s.pause(700);
    await s.click('#burst', 900);
    await s.moveTo('#live', { dy: -20 });
    await s.pause(4200);
    await s.moveTo('#feed', { dy: -60 });
    await s.pause(3000);
  }, { file: 'C01_client_burst' });

  // Fresh, full sample traffic while the dashboard is on screen.
  await admin('/admin/reset', {});
  const seeding = seed(false);
  await scene('C02', async (page, s) => {
    await s.ready(`${DASH}/`);
    await s.mark();
    await s.moveTo('#tile-saved');
    await s.pause(2600);
    await s.moveTo('#card-teams', { dx: 120, dy: -40 });
    await s.pause(2600);
    await s.moveTo('#card-models', { dy: -30 });
    await s.pause(2600);
    await s.moveTo('#tile-saved', { dy: 10 });
    await s.pause(1500);
  }, { file: 'C02_dashboard_spend' });
  await seeding;

  const smallRow = (page) =>
    page.locator('#card-recent tbody tr').filter({ has: page.locator('.tier.small') }).filter({ has: page.locator('td.save') }).filter({ hasText: 'Miss' }).first();
  const c03 = async (page, s) => {
    await s.ready(`${DASH}/`);
    await page.locator('#card-recent').scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 180));
    await sleep(500);
    const row = smallRow(page);
    if (s.beforeActions) await s.beforeActions(row);
    await s.mark();
    await s.moveTo(row.locator('.tier.small'));
    await s.pause(1500);
    await s.moveTo(row.locator('td.save'));
    await s.pause(3600);
  };
  await scene('C03', c03, { file: 'C03_routed_small_saving' });
  // Close-up: 1200x675 CSS pixels around the row, captured at 2x device pixels and scaled to 1920x1080, so it stays sharp.
  await closeUp('C03_CLOSE', c03, async (row) => {
    const rb = await row.boundingBox();
    const saved = await row.locator('td.save').boundingBox();
    const team = await row.locator('td').nth(1).boundingBox();
    const x = Math.max(0, Math.min(team.x - 20, saved.x + saved.width + 30 - 1200));
    return { x, y: Math.max(0, rb.y + rb.height / 2 - 337), width: 1200, height: 675 };
  }, 'C03_CLOSE_routed_small_saving');

  await scene('C04', async (page, s) => {
    await s.ready(`${DASH}/client`);
    await s.mark();
    await s.click('#send', 800);
    await page.locator('#answer').waitFor();
    await s.moveTo('#chip-cost', { dx: 40, dy: 26 });
    await s.pause(1800);
    await s.click('#send', 800);
    await page.locator('#answer').waitFor();
    await s.moveTo('#chip-cache');
    await s.pause(900);
    await s.moveTo('#chip-cost', { dx: 40, dy: 26 });
    await s.pause(1800);
  }, { file: 'C04_cache_hit' });

  await scene('C05', async (page, s) => {
    await s.ready(`${DASH}/redaction`);
    await s.mark();
    await s.moveTo('#original', { dy: -20 });
    await s.pause(1200);
    await s.moveTo('#redacted', { dy: -20 });
    await s.pause(1200);
    await s.click('#pii-input', 300);
    await page.keyboard.press('Control+End');
    await s.type('\nNew card 5555 5555 5555 4444, email sam.patel@example.co.uk', 12);
    await s.moveTo('#redacted', { dy: 40 });
    await s.pause(1600);
  }, { file: 'C05_redaction_view' });

  // Make sure Marketing has used up its demo budget before C06.
  for (let i = 0; i < 40 && (await chat('marketing', `Write a short newsletter intro, variant ${i}.`)) !== 429; i++);

  await scene('C06', async (page, s) => {
    await s.ready(`${DASH}/client`);
    await s.mark();
    await s.select('#preset', 'newsletter');
    await s.moveTo('#prompt', { dy: -30 });
    await s.pause(800);
    await s.click('#send', 900);
    await page.locator('#error').waitFor();
    await s.moveTo('#error', { dx: 380, dy: -62 });
    await s.pause(2800);
  }, { file: 'C06_budget_429' });

  await scene('C07', async (page, s) => {
    await s.ready(`${DASH}/providers`);
    await s.mark();
    await s.click('#traffic', 700);
    await s.moveTo('#prov-anthropic', { dy: 30 });
    await s.pause(2200);
    await s.click('#fault-anthropic', 900);
    await s.moveTo('#prov-openai', { dy: 30 });
    await s.pause(2600);
    await s.moveTo('#apps');
    await s.pause(3000);
  }, { file: 'C07_provider_outage' });
  await admin('/admin/providers/anthropic/fault', { mode: 'none' });

  await scene('C08', async (page, s) => {
    await s.ready(`${DASH}/audit`);
    await s.mark();
    await s.select('#audit-team', 'data');
    await s.moveTo('table tbody tr:nth-child(2)', { dx: 200 });
    await s.pause(1600);
    await s.moveTo('table thead', { dx: 300 });
    await s.pause(1400);
  }, { file: 'C08_audit_log' });
}

// ---------- cards and prompt moments (local HTML) ----------

const CARDS = [
  ['K01', 'K01_problem', 6.5],
  ['K02', 'K02_flow', 8.5],
  ['K03', 'K03_safeguards', 7.5],
  ['K04', 'K04_pilot', 7.5],
  ['P01', 'P01_prompt_build', 10.5],
  ['P02', 'P02_prompt_outage', 9.5],
];

async function cardScenes() {
  for (const [id, file, seconds] of CARDS) {
    await scene(id, async (page, s) => {
      await page.goto(pathToFileURL(path.join(HERE, 'cards', `${id}.html`)).href, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await s.mark();
      await page.evaluate(() => {
        if (window.play) window.play();
      });
      await sleep(seconds * 1000);
      if (id.startsWith('K')) await page.screenshot({ path: path.join(HERE, 'stills', `${file}.png`) });
    }, { file, cursor: false });
  }
}

// ---------- conversion ----------

function convert(r) {
  const out = path.join(HERE, `${r.file}.mp4`);
  if (r.concat) {
    execFileSync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', r.concat, '-vf', 'scale=1920:1080:flags=lanczos,fps=30', '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart', out], { stdio: 'ignore' });
    return;
  }
  const base = ['-y', '-ss', r.ss.toFixed(2), '-i', r.raw, '-t', r.dur.toFixed(2), '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart'];
  execFileSync('ffmpeg', [...base.slice(0, 7), '-vf', 'scale=1920:1080:flags=lanczos,fps=30', ...base.slice(7), out], { stdio: 'ignore' });
}

// ---------- main ----------

try {
  mkdirSync(path.join(HERE, 'stills'), { recursive: true });
  if (!args.includes('--no-start')) {
    if (!existsSync(path.join(ROOT, 'dashboard', '.next', 'BUILD_ID'))) execFileSync('npm', ['run', 'build', '-w', 'dashboard'], { cwd: ROOT, stdio: 'inherit' });
    start(process.execPath, ['--import', 'tsx', 'src/index.ts'], ROOT, { DEMO_MODE: '1', PORT: '8787', MOCK_LATENCY_SCALE: '1', LOG_LEVEL: 'warn' });
    start(process.execPath, [path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', '3000'], path.join(ROOT, 'dashboard'), { GATEWAY_URL: GATEWAY });
  }
  if (['C01', 'C02', 'C03', 'C04', 'C05', 'C06', 'C07', 'C08'].some(want)) {
    await waitFor(`${GATEWAY}/health`);
    await waitFor(DASH);
    await uiScenes();
  }
  await cardScenes();
  for (const r of recorded) {
    console.log(`converting ${r.id} (${r.dur.toFixed(1)} s)`);
    convert(r);
  }
  if (!args.includes('--keep-raw')) rmSync(RAW, { recursive: true, force: true });
} finally {
  for (const c of children) c.kill('SIGTERM');
}
