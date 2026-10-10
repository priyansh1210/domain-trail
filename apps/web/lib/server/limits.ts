// Per-visitor limits, duplicate-submit guard and human check (spec 014 tech §5.1, §5.5; spec 001 tech §5).
// Limits count in half-search units so "find more" / "refine" can cost half a search (FR-ABU-002).
import { rateLimits } from '@domains-all/config';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

export type Bucket = 'search' | 'search_day' | 'recheck' | 'feedback' | 'session';
export type Tier = 'anonymous' | 'signedIn';
export interface LimitResult {
  ok: boolean;
  retryAfterSec?: number;
}
export interface Limiter {
  check(bucket: Bucket, key: string, tier: Tier, units: number): Promise<LimitResult>;
}

const WINDOW_SEC: Record<Bucket, number> = {
  search: rateLimits.search.anonymous.windowSeconds,
  search_day: 86_400,
  recheck: 60,
  feedback: 3600,
  session: 3600,
};
/** Search limits are in half-search units (a full search costs 2); re-checks and feedback count 1 each. */
export function unitLimit(bucket: Bucket, tier: Tier): number {
  if (bucket === 'recheck') return rateLimits.recheckPerMinute;
  if (bucket === 'feedback') return rateLimits.feedbackPerHour;
  if (bucket === 'session') return rateLimits.anonymousSessionsPerHour;
  return 2 * (bucket === 'search' ? rateLimits.search[tier].limit : rateLimits.searchDay[tier]);
}

/** Sliding-window log per key. Used in mock mode, and as the fail-safe when Upstash is down (half limits). */
export class MemoryLimiter implements Limiter {
  private readonly log = new Map<string, Array<{ t: number; units: number }>>();
  constructor(
    private readonly factor = 1,
    private readonly now: () => number = Date.now,
  ) {}

  async check(bucket: Bucket, key: string, tier: Tier, units: number): Promise<LimitResult> {
    const id = `${bucket}:${tier}:${key}`;
    const t = this.now();
    const windowMs = WINDOW_SEC[bucket] * 1000;
    const entries = (this.log.get(id) ?? []).filter((e) => t - e.t < windowMs);
    const used = entries.reduce((a, e) => a + e.units, 0);
    const limit = Math.max(1, Math.floor(unitLimit(bucket, tier) * this.factor));
    if (used + units > limit) {
      this.log.set(id, entries);
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((entries[0]!.t + windowMs - t) / 1000)) };
    }
    entries.push({ t, units });
    this.log.set(id, entries);
    if (this.log.size > 50_000) this.log.clear();
    return { ok: true };
  }
}

export class UpstashLimiter implements Limiter {
  private readonly limiters = new Map<string, Ratelimit>();
  private readonly fallback: MemoryLimiter;
  constructor(
    private readonly redis: Redis,
    private readonly onFallback: (e: unknown) => void = () => {},
  ) {
    this.fallback = new MemoryLimiter(0.5); // FR-ABU-012: conservative, never unlimited
  }

  private limiter(bucket: Bucket, tier: Tier): Ratelimit {
    const id = `${bucket}:${tier}`;
    let l = this.limiters.get(id);
    if (!l) {
      l = new Ratelimit({
        redis: this.redis,
        limiter: Ratelimit.slidingWindow(unitLimit(bucket, tier), `${WINDOW_SEC[bucket]} s`),
        prefix: `rl:${bucket}:${tier}`,
        analytics: false,
      });
      this.limiters.set(id, l);
    }
    return l;
  }

  async check(bucket: Bucket, key: string, tier: Tier, units: number): Promise<LimitResult> {
    try {
      const r = await this.limiter(bucket, tier).limit(key, { rate: units });
      return r.success
        ? { ok: true }
        : { ok: false, retryAfterSec: Math.max(1, Math.ceil((r.reset - Date.now()) / 1000)) };
    } catch (e) {
      this.onFallback(e);
      return this.fallback.check(bucket, key, tier, units);
    }
  }
}

/** Remembers a clientRequestId for 60 s; returns the earlier search ref on a duplicate submit. */
export interface Idempotency {
  claim(clientRequestId: string, ref: string): Promise<string | null>;
}

export class MemoryIdempotency implements Idempotency {
  private readonly seen = new Map<string, { ref: string; until: number }>();
  constructor(private readonly now: () => number = Date.now) {}
  async claim(id: string, ref: string) {
    const t = this.now();
    const prev = this.seen.get(id);
    if (prev && prev.until > t) return prev.ref;
    if (this.seen.size > 10_000) this.seen.clear();
    this.seen.set(id, { ref, until: t + 60_000 });
    return null;
  }
}

export class UpstashIdempotency implements Idempotency {
  private readonly fallback = new MemoryIdempotency();
  constructor(private readonly redis: Redis) {}
  async claim(id: string, ref: string) {
    try {
      const set = await this.redis.set(`idem:${id}`, ref, { nx: true, ex: 60 });
      if (set === 'OK') return null;
      return (await this.redis.get<string>(`idem:${id}`)) ?? null;
    } catch {
      return this.fallback.claim(id, ref);
    }
  }
}

export type HumanCheck = 'ok' | 'failed' | 'unavailable';

/** Cloudflare Turnstile siteverify (FR-ABU-001). `unavailable` means fail-open with stricter limits. */
export async function verifyTurnstile(
  token: string,
  ip: string | undefined,
  secret: string,
  fetchFn: typeof fetch = fetch,
): Promise<HumanCheck> {
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set('remoteip', ip);
    const res = await fetchFn('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return 'unavailable';
    const json = (await res.json()) as { success?: boolean };
    return json.success ? 'ok' : 'failed';
  } catch {
    return 'unavailable';
  }
}

export function upstashRedis(url: string, token: string): Redis {
  return new Redis({ url, token });
}
