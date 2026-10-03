import { parseServerEnv } from '@domains-all/config';
import { describe, expect, it, vi } from 'vitest';
import { cachedHealth, computeHealth, type Health } from './health';

const live = {
  MOCK_EXTERNALS: '0',
  NEXT_PUBLIC_SUPABASE_URL: 'https://db.example.test',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  UPSTASH_REDIS_REST_URL: 'https://redis.example.test',
  UPSTASH_REDIS_REST_TOKEN: 'redis-token',
  VERCEL_GIT_COMMIT_SHA: '0123456789abcdef0123',
};

function fakeFetch(routes: Record<string, () => Response>) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const hit = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
    if (!hit) throw new Error(`unexpected ${url}`);
    return hit[1]();
  }) as unknown as typeof fetch;
}

describe('computeHealth', () => {
  it('reports mock mode without touching the network', async () => {
    const fetchFn = fakeFetch({});
    const h = await computeHealth(parseServerEnv({}), fetchFn);
    expect(h).toEqual({
      ok: true,
      db: 'ok',
      upstash: 'ok',
      jevBreaker: 'closed',
      version: 'local',
      mode: 'mock',
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('is ok in live mode when database and rate-limit store answer', async () => {
    const fetchFn = fakeFetch({
      'https://db.example.test/rest/v1/tlds': () => Response.json([{ tld: 'com' }]),
      'https://redis.example.test/ping': () => Response.json({ result: 'PONG' }),
    });
    const h = await computeHealth(parseServerEnv(live), fetchFn);
    expect(h).toEqual({
      ok: true,
      db: 'ok',
      upstash: 'ok',
      jevBreaker: 'closed',
      version: '0123456789ab',
      mode: 'live',
    });
  });

  it('marks failing dependencies down and never leaks configuration', async () => {
    const fetchFn = fakeFetch({
      'https://db.example.test': () => new Response('nope', { status: 500 }),
      'https://redis.example.test': () => {
        throw new Error('timeout');
      },
    });
    const h = await computeHealth(parseServerEnv(live), fetchFn);
    expect(h).toMatchObject({ ok: false, db: 'down', upstash: 'down' });
    const body = JSON.stringify(h);
    for (const secret of ['anon-key', 'redis-token', 'example.test']) expect(body).not.toContain(secret);
  });

  it('treats missing live configuration as down', async () => {
    const h = await computeHealth(parseServerEnv({ MOCK_EXTERNALS: '0' }), fakeFetch({}));
    expect(h).toMatchObject({ ok: false, db: 'down', upstash: 'down', mode: 'live' });
  });
});

describe('cachedHealth', () => {
  it('probes at most once per 30 seconds', async () => {
    let t = 0;
    const value: Health = {
      ok: true,
      db: 'ok',
      upstash: 'ok',
      jevBreaker: 'closed',
      version: 'x',
      mode: 'mock',
    };
    const compute = vi.fn(async () => value);
    const get = cachedHealth(compute, () => t);
    await get();
    t = 29_000;
    await get();
    expect(compute).toHaveBeenCalledTimes(1);
    t = 30_001;
    await get();
    expect(compute).toHaveBeenCalledTimes(2);
  });
});
