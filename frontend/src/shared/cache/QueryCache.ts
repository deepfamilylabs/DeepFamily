type CacheEntry<T> = { value: T; fetchedAt: number };
type QueryCacheStore = {
  cache: Map<string, CacheEntry<any>>;
  inflight: Map<string, Promise<any>>;
};

export type FetchCtx = {
  signal?: AbortSignal;
  requestId?: string;
  /** Return true when the caller's state has gone stale (e.g. modal closed, new request issued). */
  isStale?: () => boolean;
};

export class QueryCache {
  private store: QueryCacheStore;
  private scopePrefix: string;

  constructor(store?: QueryCacheStore, scopePrefix: string = "") {
    this.store =
      store ??
      {
        cache: new Map<string, CacheEntry<any>>(),
        inflight: new Map<string, Promise<any>>(),
      };
    this.scopePrefix = scopePrefix;
  }

  scoped(scope: string): QueryCache {
    const normalizedScope = String(scope || "").trim();
    if (!normalizedScope) return this;
    const nextScope = this.scopePrefix
      ? `${this.scopePrefix}::${normalizedScope}`
      : normalizedScope;
    return new QueryCache(this.store, nextScope);
  }

  private scopedKey(key: string): string {
    if (!this.scopePrefix) return key;
    return `${this.scopePrefix}::${key}`;
  }

  private scopedPrefix(prefix?: string): string {
    if (prefix === undefined) return this.scopePrefix;
    if (!this.scopePrefix) return prefix;
    return prefix ? `${this.scopePrefix}::${prefix}` : this.scopePrefix;
  }

  getEntry<T>(key: string): CacheEntry<T> | undefined {
    return this.store.cache.get(this.scopedKey(key)) as CacheEntry<T> | undefined;
  }

  get<T>(key: string, ttlMs: number): T | undefined {
    const entry = this.store.cache.get(this.scopedKey(key));
    if (!entry) return undefined;
    if (ttlMs > 0 && Date.now() - entry.fetchedAt > ttlMs) return undefined;
    return entry.value as T;
  }

  set<T>(key: string, value: T) {
    this.store.cache.set(this.scopedKey(key), { value, fetchedAt: Date.now() });
  }

  getInflight<T>(key: string): Promise<T> | undefined {
    return this.store.inflight.get(this.scopedKey(key)) as Promise<T> | undefined;
  }

  setInflight<T>(key: string, promise: Promise<T>) {
    this.store.inflight.set(this.scopedKey(key), promise);
  }

  deleteInflight(key: string) {
    this.store.inflight.delete(this.scopedKey(key));
  }

  inflightCount(): number {
    if (!this.scopePrefix) return this.store.inflight.size;
    let count = 0;
    for (const key of this.store.inflight.keys()) {
      if (key.startsWith(this.scopePrefix)) count += 1;
    }
    return count;
  }

  /** Invalidate a single key. */
  invalidate(key: string) {
    this.store.cache.delete(this.scopedKey(key));
  }

  /**
   * Invalidate all keys whose serialized string starts with `prefix`.
   * Useful for family-level invalidation (e.g. all tree keys for a person).
   */
  invalidateFamily(prefix: string) {
    const effectivePrefix = this.scopedPrefix(prefix);
    for (const key of Array.from(this.store.cache.keys())) {
      if (key.startsWith(effectivePrefix)) this.store.cache.delete(key);
    }
  }

  clear(prefix?: string) {
    const effectivePrefix = this.scopedPrefix(prefix);
    if (!effectivePrefix) {
      this.store.cache.clear();
      this.store.inflight.clear();
      return;
    }
    for (const key of Array.from(this.store.cache.keys())) {
      if (key.startsWith(effectivePrefix)) this.store.cache.delete(key);
    }
    for (const key of Array.from(this.store.inflight.keys())) {
      if (key.startsWith(effectivePrefix)) this.store.inflight.delete(key);
    }
  }

  /**
   * Unified fetch facade: returns cached value if fresh, deduplicates inflight
   * requests, and guards against stale writes.
   *
   * When multiple consumers share the same inflight request, a single consumer's
   * `signal.abort()` only prevents that consumer from writing to cache — it does
   * not cancel the shared underlying request.
   */
  async fetchQuery<T>(
    key: string,
    fetcher: (ctx: FetchCtx) => Promise<T>,
    ttlMs: number,
    ctx?: FetchCtx,
  ): Promise<T> {
    const cached = this.get<T>(key, ttlMs);
    if (cached !== undefined) return cached;

    const inflight = this.getInflight<T>(key);
    if (inflight) return inflight;

    const promise = fetcher(ctx ?? {}).then(
      (value) => {
        if (!ctx?.isStale?.()) this.set(key, value);
        this.deleteInflight(key);
        return value;
      },
      (err) => {
        this.deleteInflight(key);
        throw err;
      },
    );
    this.setInflight(key, promise);
    return promise;
  }
}
