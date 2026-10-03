// Spec 005 tech §11 `cache.test.ts` (FR-AVL-005, FR-AVL-009): freshness windows, expiry, bounded memory.
// The Supabase-backed cache (`domain_checks`) is covered in the web app's store tests.
import { availability } from '@domains-all/config/defaults';
import { describe, expect, it } from 'vitest';
import { makeResult, MemoryAvailabilityCache } from '../src/cache';

describe('availability cache', () => {
  it('uses the freshness window of each status', () => {
    for (const status of Object.keys(availability.ttlSeconds) as Array<
      keyof typeof availability.ttlSeconds
    >) {
      const r = makeResult('crumbly.com', 'com', status, 'rdap', 0);
      expect(Date.parse(r.expiresAt) / 1000).toBe(availability.ttlSeconds[status]);
    }
  });

  it('returns only fresh answers', async () => {
    const cache = new MemoryAvailabilityCache();
    await cache.putMany([makeResult('crumbly.com', 'com', 'unknown', 'rdap', 0)]);
    expect((await cache.getMany(['crumbly.com'], 59 * 60_000)).size).toBe(1);
    expect((await cache.getMany(['crumbly.com'], 61 * 60_000)).size).toBe(0);
  });

  it('drops the oldest entries when full', async () => {
    const cache = new MemoryAvailabilityCache(2);
    await cache.putMany(['a.com', 'b.com', 'c.com'].map((f) => makeResult(f, 'com', 'taken', 'dns', 0)));
    const hits = await cache.getMany(['a.com', 'b.com', 'c.com'], 1);
    expect([...hits.keys()]).toEqual(['b.com', 'c.com']);
  });
});
