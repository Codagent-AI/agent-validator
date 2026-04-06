interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class Cache<T = unknown> {
  private store = new Map<string, CacheEntry<T>>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private defaultTtlMs: number = 60_000) {
    this.startAutoCleanup();
  }

  async get(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: T, ttlMs?: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
    });
  }

  async delete(key: string): Promise<boolean> {
    return this.store.delete(key);
  }

  startAutoCleanup(intervalMs: number = 30_000): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.store) {
        if (entry.expiresAt < now) {
          this.store.delete(key);
        }
      }
    }, intervalMs);
  }

  stopAutoCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  get size(): number {
    return this.store.size;
  }
}
