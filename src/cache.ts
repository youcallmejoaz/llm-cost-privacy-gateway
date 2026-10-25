import { createHash } from 'node:crypto';
import type { KV } from './store/kv.js';
import type { ModelRef, NormalisedRequest } from './types.js';

export interface CachedReply {
  text: string;
  model: ModelRef;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/**
 * The cache only ever sees redacted text. Two requests that differ only in
 * personal data share a cache entry, and each caller gets its own values
 * restored, because the provider never saw those values in the first place.
 */
export function normalise(req: NormalisedRequest): string {
  return JSON.stringify({
    m: req.messages.map((x) => [x.role, x.content.replace(/\s+/g, ' ').trim()]),
    t: req.maxTokens ?? null,
    temp: req.temperature ?? null,
    j: req.responseFormatJson ?? false,
  });
}

export class ExactCache {
  constructor(private kv: KV, private ttlSeconds: number) {}

  key(scope: string, modelKey: string, req: NormalisedRequest): string {
    const h = createHash('sha256').update(`${modelKey}\n${normalise(req)}`).digest('hex');
    return `cache:${scope}:${h}`;
  }

  async get(key: string): Promise<CachedReply | null> {
    const v = await this.kv.get(key);
    return v ? (JSON.parse(v) as CachedReply) : null;
  }

  async set(key: string, value: CachedReply): Promise<void> {
    await this.kv.set(key, JSON.stringify(value), this.ttlSeconds);
  }

  async clear(): Promise<void> {
    await this.kv.deletePrefix('cache:');
  }
}

const DIMS = 512;

/** Cheap local embedding (hashed word and word-pair counts). Good for near duplicates, not paraphrases. */
export function embed(text: string): Float32Array {
  const v = new Float32Array(DIMS);
  const words = text.toLowerCase().match(/[a-z0-9\[\]_]+/g) ?? [];
  const add = (s: string, w: number) => {
    const h = createHash('md5').update(s).digest();
    v[h.readUInt16LE(0) % DIMS] += h[2] & 1 ? w : -w;
  };
  words.forEach((w, i) => {
    add(w, 1);
    if (i > 0) add(`${words[i - 1]} ${w}`, 0.5);
  });
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < DIMS; i++) v[i] /= n;
  return v;
}

function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < DIMS; i++) s += a[i] * b[i];
  return s;
}

/** Optional, behind SEMANTIC_CACHE=1. In-process only in this build. */
export class SemanticCache {
  private entries: Array<{ scope: string; sig: string; vec: Float32Array; value: CachedReply; exp: number }> = [];

  constructor(private threshold: number, private ttlSeconds: number) {}

  private sig(modelKey: string, req: NormalisedRequest) {
    return `${modelKey}|${req.maxTokens ?? ''}|${req.responseFormatJson ?? false}|${req.messages.map((m) => m.role).join(',')}`;
  }

  get(scope: string, modelKey: string, req: NormalisedRequest): { value: CachedReply; similarity: number } | null {
    const now = Date.now();
    const sig = this.sig(modelKey, req);
    const vec = embed(req.messages.map((m) => m.content).join('\n'));
    let best: { value: CachedReply; similarity: number } | null = null;
    for (const e of this.entries) {
      if (e.exp < now || e.scope !== scope || e.sig !== sig) continue;
      const s = cosine(vec, e.vec);
      if (s >= this.threshold && (!best || s > best.similarity)) best = { value: e.value, similarity: s };
    }
    return best;
  }

  set(scope: string, modelKey: string, req: NormalisedRequest, value: CachedReply): void {
    this.entries.push({ scope, sig: this.sig(modelKey, req), vec: embed(req.messages.map((m) => m.content).join('\n')), value, exp: Date.now() + this.ttlSeconds * 1000 });
    if (this.entries.length > 5000) this.entries.shift();
  }

  clear(): void {
    this.entries = [];
  }
}
