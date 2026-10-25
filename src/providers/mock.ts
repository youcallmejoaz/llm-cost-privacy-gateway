import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../config.js';
import { estimateTokens } from '../pricing.js';
import { classifyTask } from '../routing/classifier.js';
import type { NormalisedRequest, NormalisedResponse, ProviderId, Task } from '../types.js';
import type { FaultController } from './faults.js';
import { ProviderError, type Provider } from './types.js';

type Fixture = string | { match: string[]; text: string };
type Fixtures = Record<Task, Fixture[]>;
let fixtures: Fixtures | null = null;
function loadFixtures(): Fixtures {
  fixtures ??= JSON.parse(readFileSync(path.join(ROOT_DIR, 'fixtures', 'mock-responses.json'), 'utf8')) as Fixtures;
  return fixtures;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (ms <= 0) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      reject(signal.reason);
    }, { once: true });
  });

/**
 * Deterministic stand-in for a real vendor. Same request in, same reply out,
 * with realistic token counts and latency. Records what it received so tests
 * can prove no raw personal data reached it.
 */
export class MockProvider implements Provider {
  readonly mock = true;
  readonly received: Array<{ model: string; req: NormalisedRequest }> = [];

  constructor(
    readonly id: ProviderId,
    private faults: FaultController,
    private latencyScale = 1,
  ) {}

  async chat(model: string, req: NormalisedRequest, signal: AbortSignal): Promise<NormalisedResponse> {
    this.received.push({ model, req: structuredClone(req) });
    const fault = this.faults.get(this.id);
    if (fault === 'error') {
      await sleep(40 * this.latencyScale, signal);
      throw new ProviderError(`${this.id} returned 503 Service Unavailable (simulated outage)`, this.id, true);
    }
    if (fault === 'timeout') {
      await sleep(10 * 60_000, signal); // until the gateway's timeout aborts us
    }

    const prompt = req.messages.map((m) => m.content).join('\n');
    if (req.messages[0]?.content.startsWith('GATEWAY_TASK_CLASSIFIER')) {
      await sleep(60 * this.latencyScale, signal);
      const label = classifyTask(req.messages.slice(1));
      return { text: label, inputTokens: estimateTokens(prompt), outputTokens: 1, finishReason: 'stop' };
    }
    const hash = createHash('sha256').update(model + prompt).digest();
    const small = /mini|flash|haiku/.test(model);
    const task = classifyTask(req.messages);
    const options = loadFixtures()[task] ?? loadFixtures().chat;
    const refs = [...new Set(prompt.match(/\[[A-Z_]+_\d+\]/g) ?? [])].join(', ');
    let text = pickReply(options, prompt.toLowerCase(), hash[0]);
    // Echo the redaction tokens like a real model quoting contact details back; drop the slot if there are none.
    text = refs ? text.replaceAll('{{refs}}', refs) : text.replace(/ ?\(\{\{refs\}\}\)/g, '').replace(/\n*[^\n]*\{\{refs\}\}[^\n]*/g, '').replaceAll('{{refs}}', '');
    if (req.maxTokens && estimateTokens(text) > req.maxTokens) text = text.slice(0, req.maxTokens * 4);

    const inputTokens = estimateTokens(prompt) + 4 * req.messages.length;
    const outputTokens = estimateTokens(text);
    const base = small ? 180 : 650;
    const perToken = small ? 1.2 : 4;
    const jitter = hash[1] % 120;
    await sleep((base + jitter + outputTokens * perToken * 0.25) * this.latencyScale, signal);
    return { text, inputTokens, outputTokens, finishReason: 'stop' };
  }
}

/** Prefer the recorded reply whose topic words appear in the prompt; otherwise pick by hash. */
function pickReply(options: Fixture[], prompt: string, seed: number): string {
  let best = -1;
  let bestScore = 0;
  options.forEach((o, i) => {
    if (typeof o === 'string') return;
    const score = o.match.filter((w) => prompt.includes(w)).length;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  const chosen = options[best >= 0 ? best : seed % options.length];
  return typeof chosen === 'string' ? chosen : chosen.text;
}
