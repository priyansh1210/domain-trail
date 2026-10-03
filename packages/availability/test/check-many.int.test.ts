// Spec 005 tech §11 `check-many.int.test.ts` (FR-AVL-001, 003, 005, 006, 008, 009, 013, 014): order of steps,
// streaming callback, statuses, deadline → unknown, caps, re-check and re-verification.
import { availability } from '@domains-all/config/defaults';
import { describe, expect, it, vi } from 'vitest';
import { makeResult, MemoryAvailabilityCache } from '../src/cache';
import { createChecker, MemoryDailyCounter } from '../src/checker';
import { RdapDirectory } from '../src/directory';
import { HostLimiter } from '../src/limiter';
import type { CheckResult } from '../src/types';

const directory = new RdapDirectory(
  {
    com: 'https://rdap.verisign.com/com/v1/',
    shop: 'https://rdap.gmoregistry.net/rdap/',
    app: 'https://pubapi.registry.google/rdap/',
  },
  'test',
);

/** Scripted internet: DNS NS answers by name, RDAP answers by name; wildcard probes (20 letters) per TLD. */
function world(
  opts: {
    registered?: string[];
    rdapTaken?: string[];
    rdapDown?: string[];
    wildcardTlds?: string[];
    slow?: string[];
  } = {},
) {
  const calls: string[] = [];
  const fetchFn = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url.href);
    if (url.hostname === 'cloudflare-dns.com' || url.hostname === 'dns.google') {
      const name = url.searchParams.get('name')!;
      const label = name.slice(0, name.indexOf('.'));
      const tld = name.slice(name.indexOf('.') + 1);
      if (label.length === 20) {
        return Response.json(
          opts.wildcardTlds?.includes(tld) ? { Status: 0, Answer: [{ name, type: 1 }] } : { Status: 3 },
        );
      }
      return Response.json(
        opts.registered?.includes(name)
          ? { Status: 0, Answer: [{ name: `${name}.`, type: 2 }] }
          : { Status: 3 },
      );
    }
    const fqdn = decodeURIComponent(url.pathname.split('/domain/')[1]!);
    if (opts.slow?.includes(fqdn)) await new Promise((r) => setTimeout(r, 300));
    if (opts.rdapDown?.includes(fqdn)) return new Response('', { status: 503 });
    if (opts.rdapTaken?.includes(fqdn)) return Response.json({ status: ['active'] });
    return new Response('', { status: 404 });
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, calls };
}

const checker = (fetchFn: typeof fetch, extra: Partial<Parameters<typeof createChecker>[0]> = {}) =>
  createChecker({
    directory: { get: () => directory },
    userAgent: 'test',
    fetchFn,
    sleep: async () => undefined,
    limiter: new HostLimiter({ rps: 1000, burst: 1000, sleep: async () => undefined }),
    randomLabel: () => 'zzzzzzzzzzzzzzzzzzzz',
    ...extra,
  });

describe('checkMany', () => {
  it('uses DNS to rule out registered names and RDAP to confirm the rest, streaming each result', async () => {
    const w = world({ registered: ['bread.com'], rdapTaken: ['undelegated.shop'] });
    const seen: string[] = [];
    const { results } = await checker(w.fetchFn).checkMany(
      ['bread.com', 'crumbly.com', 'undelegated.shop', 'crumbly.io'],
      {
        deadline: Date.now() + 5000,
        onResult: (r) => seen.push(`${r.fqdn}:${r.status}`),
      },
    );
    const by = Object.fromEntries(results.map((r) => [r.fqdn, r]));
    expect(by['bread.com']).toMatchObject({ status: 'taken', method: 'dns' });
    expect(by['crumbly.com']).toMatchObject({ status: 'available', method: 'rdap' });
    expect(by['undelegated.shop']).toMatchObject({ status: 'taken', method: 'rdap' });
    // .io has no registry RDAP: DNS alone can only say "likely available"
    expect(by['crumbly.io']).toMatchObject({ status: 'likely_available', method: 'dns' });
    expect(seen).toHaveLength(4);
    expect(w.calls.some((c) => c.includes('rdap.verisign.com/com/v1/domain/bread.com'))).toBe(false);
  });

  it('gives each status its freshness window and shares answers between searches', async () => {
    const cache = new MemoryAvailabilityCache();
    const w = world({ registered: ['bread.com'] });
    const c = checker(w.fetchFn, { cache });
    await c.checkMany(['bread.com', 'crumbly.com'], { deadline: Date.now() + 5000 });
    const stored = await cache.getMany(['bread.com', 'crumbly.com'], Date.now());
    const ttl = (r: CheckResult) => (Date.parse(r.expiresAt) - Date.parse(r.checkedAt)) / 1000;
    expect(ttl(stored.get('bread.com')!)).toBe(availability.ttlSeconds.taken);
    expect(ttl(stored.get('crumbly.com')!)).toBe(availability.ttlSeconds.available);

    const again = world();
    const second = await checker(again.fetchFn, { cache }).checkMany(['bread.com', 'crumbly.com'], {
      deadline: Date.now() + 5000,
    });
    expect(second.stats.cached).toBe(2);
    expect(second.results.every((r) => r.method === 'cache')).toBe(true);
    expect(again.calls).toHaveLength(0);
  });

  it('skips DNS for extensions that answer every name (wildcards)', async () => {
    const w = world({ wildcardTlds: ['app'] });
    const { results } = await checker(w.fetchFn).checkMany(['crumbly.app'], { deadline: Date.now() + 5000 });
    expect(results[0]).toMatchObject({ status: 'available', method: 'rdap' });
    expect(w.calls.filter((c) => c.includes('type=NS'))).toHaveLength(0);
  });

  it('says unknown when the registry fails, and when the deadline passes (late answers still fill the cache)', async () => {
    const cache = new MemoryAvailabilityCache();
    const w = world({ rdapDown: ['broken.com'], slow: ['slow.com'] });
    const { results, stats } = await checker(w.fetchFn, { cache }).checkMany(['broken.com', 'slow.com'], {
      deadline: Date.now() + 150,
    });
    expect(results.map((r) => r.status)).toEqual(['unknown', 'unknown']);
    expect(stats.late).toBe(1);
    await new Promise((r) => setTimeout(r, 400));
    expect((await cache.getMany(['slow.com'], Date.now())).get('slow.com')?.status).toBe('available');
  });

  it('stops RDAP at the per-search cap and switches to cache-only at the daily cap', async () => {
    const names = Array.from({ length: availability.rdapMaxPerSearch + 5 }, (_, i) => `name${i}.com`);
    const { results } = await checker(world().fetchFn).checkMany(names, { deadline: Date.now() + 10_000 });
    expect(results.filter((r) => r.status === 'unknown')).toHaveLength(5);

    const counter = new MemoryDailyCounter();
    await counter.add('rdap', availability.rdapDailyCap);
    const paused = await checker(world().fetchFn, { counter }).checkMany(['crumbly.com'], {
      deadline: Date.now() + 5000,
    });
    expect(paused.stats.paused).toBe(true);
    expect(paused.results[0]!.status).toBe('unknown');
  });

  it('re-checks one name without the cache, and re-verifies an old cached "available" shown near the top', async () => {
    const cache = new MemoryAvailabilityCache();
    const old = Date.now() - 60 * 60_000;
    await cache.putMany([makeResult('crumbly.com', 'com', 'available', 'rdap', old)]);
    const w = world({ rdapTaken: ['crumbly.com'] });
    const c = checker(w.fetchFn, { cache });

    const updates: CheckResult[] = [];
    await c.checkMany(['crumbly.com'], {
      deadline: Date.now() + 5000,
      reverify: new Set(['crumbly.com']),
      onUpdate: (r) => updates.push(r),
    });
    expect(updates[0]).toMatchObject({ fqdn: 'crumbly.com', status: 'taken' });

    await cache.putMany([makeResult('crumbly.com', 'com', 'available', 'rdap', Date.now())]);
    expect((await c.recheckOne('crumbly.com')).status).toBe('taken');
  });
});
