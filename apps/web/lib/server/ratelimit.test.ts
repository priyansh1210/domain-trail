// Spec 014 tech §11 `ratelimit.test.ts`, `ratelimit-fallback.test.ts` (in this file) and spec 012
// `visitor-hash.test.ts` coverage for the hashing helper (FR-ABU-002, FR-ABU-012, FR-DATA-011).
import { describe, expect, it } from 'vitest';
import { MemoryLimiter, unitLimit, UpstashLimiter } from './limits';
import { visitorHash } from './visitor';
import type { Redis } from '@upstash/redis';

describe('search limits', () => {
  it('allows 5 searches per 10 minutes and 30 per day for anonymous visitors, 60 per day signed in', () => {
    expect(unitLimit('search', 'anonymous')).toBe(10); // half-search units
    expect(unitLimit('search_day', 'anonymous')).toBe(60);
    expect(unitLimit('search_day', 'signedIn')).toBe(120);
  });

  it('counts "find more" as half a search', async () => {
    let t = 0;
    const l = new MemoryLimiter(1, () => t);
    for (let i = 0; i < 4; i++) expect((await l.check('search', 'v', 'anonymous', 2)).ok).toBe(true);
    expect((await l.check('search', 'v', 'anonymous', 1)).ok).toBe(true);
    expect((await l.check('search', 'v', 'anonymous', 1)).ok).toBe(true);
    const blocked = await l.check('search', 'v', 'anonymous', 1);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBe(600);
    t += 600_000;
    expect((await l.check('search', 'v', 'anonymous', 2)).ok).toBe(true);
  });

  it('falls back to half limits in memory when the limit store fails (FR-ABU-012)', async () => {
    const broken = {
      evalsha: () => Promise.reject(new Error('down')),
      eval: () => Promise.reject(new Error('down')),
    } as unknown as Redis;
    const fallbacks: unknown[] = [];
    const l = new UpstashLimiter(broken, (e) => fallbacks.push(e));
    expect((await l.check('search', 'v', 'anonymous', 2)).ok).toBe(true);
    expect((await l.check('search', 'v', 'anonymous', 2)).ok).toBe(true);
    expect((await l.check('search', 'v', 'anonymous', 2)).ok).toBe(false); // 5 units = half of 10
    expect(fallbacks.length).toBeGreaterThan(0);
  });
});

describe('visitor hash (FR-DATA-011)', () => {
  const secret = 's'.repeat(32);
  it('is stable within a day, rotates daily and never contains the IP', () => {
    const day1 = new Date('2026-10-03T10:00:00Z');
    const a = visitorHash('203.0.113.7', 'ua', secret, day1);
    expect(visitorHash('203.0.113.7', 'ua', secret, new Date('2026-10-03T23:59:00Z'))).toBe(a);
    expect(visitorHash('203.0.113.7', 'ua', secret, new Date('2026-10-04T00:00:01Z'))).not.toBe(a);
    expect(visitorHash('203.0.113.8', 'ua', secret, day1)).not.toBe(a);
    expect(a).not.toContain('203');
  });
});
