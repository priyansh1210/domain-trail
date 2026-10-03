// Spec 005 tech §11 `rdap.test.ts` (FR-AVL-001, 003, 007, 008): 404 / 200 / pending delete / 429 Retry-After /
// 5xx retry / timeouts / size limit.
import { describe, expect, it, vi } from 'vitest';
import { classifyRecord, rdapLookup } from '../src/rdap';

const base = 'https://rdap.example-registry.net/rdap/';
const opts = (fetchFn: unknown) => ({
  fetchFn: fetchFn as typeof fetch,
  userAgent: 'test-agent (+https://example.org)',
  sleep: async () => undefined,
});

describe('RDAP lookup', () => {
  it('maps 404 to available and sends our user agent', async () => {
    const fetchFn = vi.fn(async () => new Response('', { status: 404 }));
    expect(await rdapLookup('crumb.shop', base, opts(fetchFn))).toMatchObject({ status: 'available' });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://rdap.example-registry.net/rdap/domain/crumb.shop');
    expect((init.headers as Record<string, string>)['user-agent']).toContain('test-agent');
  });

  it('maps 200 to taken, or dropping soon with the expiration date', async () => {
    const active = vi.fn(async () => Response.json({ status: ['active'] }));
    expect((await rdapLookup('crumb.shop', base, opts(active))).status).toBe('taken');
    const dropping = vi.fn(async () =>
      Response.json({
        status: ['pending delete', 'server hold'],
        events: [{ eventAction: 'expiration', eventDate: '2026-09-01T00:00:00Z' }],
      }),
    );
    expect(await rdapLookup('crumb.shop', base, opts(dropping))).toMatchObject({
      status: 'dropping_soon',
      expiration: '2026-09-01T00:00:00Z',
    });
  });

  it('treats an oversized or odd 200 body as taken, never as available', () => {
    expect(classifyRecord(undefined).status).toBe('taken');
    expect(classifyRecord('<html>').status).toBe('taken');
  });

  it('waits for a short Retry-After once, then reports the host as rate-limited', async () => {
    const sleep = vi.fn(async () => undefined);
    const limited = vi.fn(async () => new Response('', { status: 429, headers: { 'retry-after': '2' } }));
    const r = await rdapLookup('crumb.shop', base, { ...opts(limited), sleep });
    expect(r).toMatchObject({ status: 'unknown', rateLimited: true });
    expect(limited).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);

    const longWait = vi.fn(async () => new Response('', { status: 429, headers: { 'retry-after': '60' } }));
    expect(await rdapLookup('crumb.shop', base, opts(longWait))).toMatchObject({
      status: 'unknown',
      rateLimited: true,
    });
    expect(longWait).toHaveBeenCalledTimes(1);
  });

  it('retries a 5xx or network error once, then says unknown', async () => {
    const flaky = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('', { status: 404 }));
    expect((await rdapLookup('crumb.shop', base, opts(flaky))).status).toBe('available');
    const down = vi.fn().mockRejectedValue(new Error('timeout'));
    expect((await rdapLookup('crumb.shop', base, opts(down))).status).toBe('unknown');
    expect(down).toHaveBeenCalledTimes(2);
    const odd = vi.fn(async () => new Response('', { status: 400 }));
    expect((await rdapLookup('crumb.shop', base, opts(odd))).status).toBe('unknown');
  });
});
