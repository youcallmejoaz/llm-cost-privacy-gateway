import { Redis } from 'ioredis';

/** Small key-value surface used for cache, budget counters and rate limits. */
export interface KV {
  readonly kind: 'redis' | 'memory';
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  incrBy(key: string, n: number, ttlSeconds?: number): Promise<number>;
  deletePrefix(prefix: string): Promise<void>;
  close(): Promise<void>;
}

export class MemoryKV implements KV {
  readonly kind = 'memory' as const;
  private data = new Map<string, { v: string; exp: number }>();

  async get(key: string) {
    const e = this.data.get(key);
    if (!e) return null;
    if (e.exp && e.exp < Date.now()) {
      this.data.delete(key);
      return null;
    }
    return e.v;
  }

  async set(key: string, value: string, ttlSeconds?: number) {
    this.data.set(key, { v: value, exp: ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0 });
  }

  async incrBy(key: string, n: number, ttlSeconds?: number) {
    const cur = Number((await this.get(key)) ?? 0) + n;
    const existing = this.data.get(key);
    this.data.set(key, { v: String(cur), exp: existing?.exp || (ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0) });
    return cur;
  }

  async deletePrefix(prefix: string) {
    for (const k of this.data.keys()) if (k.startsWith(prefix)) this.data.delete(k);
  }

  async close() {}
}

export class RedisKV implements KV {
  readonly kind = 'redis' as const;
  constructor(private redis: Redis) {}

  static async connect(url: string): Promise<RedisKV> {
    const redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 2 });
    await redis.connect();
    return new RedisKV(redis);
  }

  get(key: string) {
    return this.redis.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number) {
    if (ttlSeconds) await this.redis.set(key, value, 'EX', ttlSeconds);
    else await this.redis.set(key, value);
  }

  async incrBy(key: string, n: number, ttlSeconds?: number) {
    const [[, v]] = (await this.redis.multi().incrby(key, n).exec()) as [[Error | null, number]];
    if (ttlSeconds) await this.redis.expire(key, ttlSeconds, 'NX');
    return v;
  }

  async deletePrefix(prefix: string) {
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 500);
      if (keys.length) await this.redis.del(...keys);
      cursor = next;
    } while (cursor !== '0');
  }

  async close() {
    await this.redis.quit();
  }
}
