type CacheEntry<T> = { value: T; fetchedAt: number }

export class QueryCache {
  private cache = new Map<string, CacheEntry<any>>()
  private inflight = new Map<string, Promise<any>>()

  get<T>(key: string, ttlMs: number): T | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined
    if (ttlMs > 0 && Date.now() - entry.fetchedAt > ttlMs) return undefined
    return entry.value as T
  }

  set<T>(key: string, value: T) {
    this.cache.set(key, { value, fetchedAt: Date.now() })
  }

  getInflight<T>(key: string): Promise<T> | undefined {
    return this.inflight.get(key) as Promise<T> | undefined
  }

  setInflight<T>(key: string, promise: Promise<T>) {
    this.inflight.set(key, promise)
  }

  deleteInflight(key: string) {
    this.inflight.delete(key)
  }

  inflightCount(): number {
    return this.inflight.size
  }

  clear(prefix?: string) {
    if (!prefix) {
      this.cache.clear()
      this.inflight.clear()
      return
    }
    for (const key of Array.from(this.cache.keys())) {
      if (key.startsWith(prefix)) this.cache.delete(key)
    }
    for (const key of Array.from(this.inflight.keys())) {
      if (key.startsWith(prefix)) this.inflight.delete(key)
    }
  }
}
