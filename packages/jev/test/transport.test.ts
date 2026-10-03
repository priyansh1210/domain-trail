// Spec 002 tech §11 `transport.test.ts` (FR-JEV-005, 006, 010, 011).
import { describe, expect, it, vi } from 'vitest';
import { createHttpTransport, ROUTES } from '../src/transport';
import type { SystemOneRequest } from '../src/types';

const body: SystemOneRequest = {
  model: 'jev-1.13.0',
  state: 'x',
  questions: { q: { type: 'noul', instructions: 'y' } },
};
const ok = () =>
  new Response(
    JSON.stringify({
      model: 'jev-1.13.0',
      answers: { q: { type: 'noul', noul: 0.5 } },
      usage: { input_tokens: 12 },
    }),
    {
      status: 200,
      headers: { 'x-typesafe-request-id': 'req_1' },
    },
  );

function setup(responses: Array<() => Response | Promise<Response>>) {
  let t = 0;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    return next();
  }) as unknown as typeof fetch;
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const transport = createHttpTransport({
    route: 'gateway',
    apiKey: 'key-123',
    fetchFn,
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    random: () => 0.5,
    log,
  });
  return { transport, calls, log, advance: (ms: number) => (t += ms) };
}

describe('http transport', () => {
  it('posts to the configured route with the bearer key and logs the request id', async () => {
    const { transport, calls, log } = setup([ok]);
    const r = await transport.send(body, { deadline: 10_000, searchId: 's1', stage: 'S1' });
    expect(r).toMatchObject({ ok: true, requestId: 'req_1' });
    expect(calls[0]!.url).toBe(ROUTES.gateway);
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer key-123');
    expect(log.info).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'req_1', inputTokens: 12 }));
    expect(JSON.stringify(log.info.mock.calls)).not.toContain('key-123');
  });

  it('retries 429, 529 and 5xx, then succeeds', async () => {
    const { transport, calls } = setup([
      () => new Response('', { status: 429 }),
      () => new Response('', { status: 529 }),
      ok,
    ]);
    const r = await transport.send(body, { deadline: 10_000, searchId: 's1' });
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(3);
  });

  it('gives up after two retries', async () => {
    const { transport, calls } = setup(
      Array.from({ length: 5 }, () => () => new Response('', { status: 503 })),
    );
    const r = await transport.send(body, { deadline: 10_000, searchId: 's1' });
    expect(r).toMatchObject({ ok: false, error: 'retryable', status: 503 });
    expect(calls).toHaveLength(3);
  });

  it('never retries 401 or 422', async () => {
    const a = setup([() => new Response('', { status: 401 })]);
    expect(await a.transport.send(body, { deadline: 10_000, searchId: 's' })).toMatchObject({
      ok: false,
      error: 'auth',
    });
    expect(a.calls).toHaveLength(1);
    const b = setup([() => new Response('', { status: 422 })]);
    expect(await b.transport.send(body, { deadline: 10_000, searchId: 's' })).toMatchObject({
      ok: false,
      error: 'invalid',
    });
    expect(b.calls).toHaveLength(1);
  });

  it('does not wait past the stage deadline (Retry-After too long)', async () => {
    const { transport, calls } = setup([
      () => new Response('', { status: 429, headers: { 'retry-after': '30' } }),
      ok,
    ]);
    const r = await transport.send(body, { deadline: 2_000, searchId: 's' });
    expect(r).toMatchObject({ ok: false, error: 'retryable' });
    expect(calls).toHaveLength(1);
  });

  it('does not send when the deadline has passed', async () => {
    const { transport, calls, advance } = setup([ok]);
    advance(5_000);
    expect(await transport.send(body, { deadline: 5_010, searchId: 's' })).toMatchObject({
      ok: false,
      error: 'timeout',
    });
    expect(calls).toHaveLength(0);
  });

  it('treats network errors as retryable', async () => {
    const { transport, calls } = setup([
      () => {
        throw new TypeError('fetch failed');
      },
      ok,
    ]);
    expect((await transport.send(body, { deadline: 10_000, searchId: 's' })).ok).toBe(true);
    expect(calls).toHaveLength(2);
  });
});
