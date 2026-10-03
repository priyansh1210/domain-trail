// Every outbound call is bounded (spec 000; incident 2026-10-04: on the production host some requests ignored the
// abort signal and a search never finished). `timedFetch` and `within` must settle even then.
import { describe, expect, it } from 'vitest';
import { timedFetch, within } from '../src/net';

const never = (() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;

describe('timedFetch', () => {
  it('returns status, headers and body', async () => {
    const r = await timedFetch('https://example.org', {
      timeoutMs: 1000,
      fetchFn: async () => new Response('hi', { status: 201 }),
    });
    expect(r).toMatchObject({ status: 201, ok: true, text: 'hi' });
  });

  it('settles at the time limit even if the request never answers or ignores the abort', async () => {
    const t0 = Date.now();
    expect(await timedFetch('https://example.org', { timeoutMs: 100, fetchFn: never })).toBeUndefined();
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('returns undefined on network errors and drops oversized bodies', async () => {
    expect(
      await timedFetch('https://example.org', {
        timeoutMs: 1000,
        fetchFn: async () => Promise.reject(new Error('offline')),
      }),
    ).toBeUndefined();
    const big = await timedFetch('https://example.org', {
      timeoutMs: 1000,
      maxBytes: 3,
      fetchFn: async () => new Response('too long'),
    });
    expect(big).toMatchObject({ ok: true, text: undefined });
  });
});

describe('within', () => {
  it('gives the fallback when the promise is late or fails', async () => {
    expect(await within(new Promise<string>(() => undefined), 50, 'late')).toBe('late');
    expect(await within(Promise.reject(new Error('x')), 50, 'failed')).toBe('failed');
    expect(await within(Promise.resolve('ok'), 50, 'late')).toBe('ok');
  });
});
