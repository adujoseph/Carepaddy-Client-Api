import { redis } from '@lib/redis';

export interface KeyValueStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  incr(key: string, ttlSeconds?: number): Promise<number>;
}

type Entry = {
  value: unknown;
  expiresAt: number;
};

/** In-memory store — useful for local tests without Redis. */
export class MemoryKeyValueStore implements KeyValueStore {
  private readonly store = new Map<string, Entry>();

  private purge(key: string): void {
    const entry = this.store.get(key);
    if (entry && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
    }
  }

  async get<T>(key: string): Promise<T | null> {
    this.purge(key);
    const entry = this.store.get(key);
    return entry ? (entry.value as T) : null;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async incr(key: string, ttlSeconds = 600): Promise<number> {
    this.purge(key);
    const current = (await this.get<number>(key)) ?? 0;
    const next = current + 1;
    const existing = this.store.get(key);
    const expiresAt = existing?.expiresAt ?? Date.now() + ttlSeconds * 1000;
    this.store.set(key, { value: next, expiresAt });
    return next;
  }
}

/** Redis-backed store — used in staging/production. */
export class RedisKeyValueStore implements KeyValueStore {
  async get<T>(key: string): Promise<T | null> {
    const raw = await redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  async del(key: string): Promise<void> {
    await redis.del(key);
  }

  async incr(key: string, ttlSeconds = 600): Promise<number> {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, ttlSeconds);
    }
    return count;
  }
}

export const kvStore: KeyValueStore =
  process.env.KV_STORE === 'memory'
    ? new MemoryKeyValueStore()
    : new RedisKeyValueStore();
