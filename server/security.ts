/** Small, dependency-free request guards for the lesson backend. */

/** Fixed-window request counter per key (e.g. per client address). */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  private max: number;
  private windowMs: number;
  private now: () => number;

  constructor(max: number, windowMs: number, now: () => number = Date.now) {
    this.max = max;
    this.windowMs = windowMs;
    this.now = now;
  }

  check(key: string): { ok: true } | { ok: false; retryAfterSec: number } {
    const t = this.now();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= t) {
      this.hits.set(key, { count: 1, resetAt: t + this.windowMs });
      this.prune(t);
      return { ok: true };
    }
    if (entry.count >= this.max) return { ok: false, retryAfterSec: Math.ceil((entry.resetAt - t) / 1000) };
    entry.count++;
    return { ok: true };
  }

  private prune(t: number) {
    if (this.hits.size < 5000) return;
    for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k);
  }
}

/** Exact-match allow-list. CORS limits browsers only; it is not authentication. */
export function isAllowedOrigin(origin: string | undefined, allowed: string[]): boolean {
  if (!origin) return false;
  return allowed.includes(origin.replace(/\/$/, ''));
}

export function parseOrigins(value: string | undefined, fallback: string[]): string[] {
  const list = (value ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
  return list.length ? list : fallback;
}

/** Bounded in-memory cache with expiry. Nothing is written to disk. */
export class TtlCache<T> {
  private map = new Map<string, { value: T; expiresAt: number }>();
  private maxEntries: number;
  private ttlMs: number;
  private now: () => number;

  constructor(maxEntries: number, ttlMs: number, now: () => number = Date.now) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    this.now = now;
  }

  get(key: string): T | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: T) {
    this.map.delete(key);
    this.map.set(key, { value, expiresAt: this.now() + this.ttlMs });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }
}
