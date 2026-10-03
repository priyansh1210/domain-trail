// Re-check (spec 005 FR-AVL-014), feedback (spec 008 FR-RANK-012) and "find more in this range" (spec 006
// FR-PRC-009) against in-memory services and recorded DNS/RDAP answers.
import { parseServerEnv } from '@domains-all/config';
import type { ResultItem } from '@domains-all/core';
import { describe, expect, it } from 'vitest';
import { handleFeedback, handleRecheck } from './domains';
import { handleMore } from './more';
import { handleSearch } from './search';
import { buildServices, type Services } from './services';
import type { MemoryFeedbackStore } from './store';

const DESCRIPTION = 'Online bakery in Pune delivering sourdough bread and cakes to families';
const svc = (env: Record<string, string> = {}): Services =>
  buildServices(parseServerEnv({ RATE_LIMIT_MODE: 'off', PUBLIC_DATA_MODE: 'fixture', ...env }));
const req = (url: string, body?: unknown, ip = '203.0.113.9') =>
  new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'vitest', 'x-forwarded-for': ip },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

async function events(res: Response) {
  return (await res.text())
    .split('\n\n')
    .filter((b) => b.startsWith('event:'))
    .map((b) => {
      const [e, d] = b.split('\n');
      return { event: e!.slice(7), data: JSON.parse(d!.slice(6)) as unknown };
    });
}

async function search(s: Services) {
  const ev = await events(
    await handleSearch(
      req('http://localhost/api/search', {
        description: DESCRIPTION,
        preferences: {},
        turnstileToken: 'token',
        clientRequestId: crypto.randomUUID(),
      }),
      s,
    ),
  );
  const ref = (ev[0]!.data as { ref: string }).ref;
  const results = ev
    .filter((e) => e.event === 'batch')
    .flatMap((e) => (e.data as { results: ResultItem[] }).results);
  return { ref, results };
}

describe('re-check', () => {
  it('returns a fresh status, check time and price', async () => {
    const s = svc();
    const res = await handleRecheck(
      req('http://localhost/api/domains/crumbly.com/recheck'),
      'crumbly.com',
      s,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      fqdn: string;
      status: string;
      checkedAt: string;
      price?: { source: string };
    };
    expect(body.fqdn).toBe('crumbly.com');
    expect(['available', 'taken']).toContain(body.status);
    expect(Date.parse(body.checkedAt)).toBeGreaterThan(Date.now() - 10_000);
    if (body.status === 'available') expect(body.price?.source).toBe('Porkbun');
  });

  it('rejects anything that is not a domain name, and limits re-checks per visitor', async () => {
    const s = svc({ RATE_LIMIT_MODE: 'enforce' });
    expect((await handleRecheck(req('http://x/'), 'not a domain', s)).status).toBe(400);
    for (let i = 0; i < 10; i++)
      expect((await handleRecheck(req('http://x/'), `name${i}.com`, s)).status).toBe(200);
    const limited = await handleRecheck(req('http://x/'), 'name11.com', s);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

describe('feedback', () => {
  it('stores one vote per search, name and visitor', async () => {
    const s = svc();
    const { ref } = await search(s);
    const res = await handleFeedback(
      req('http://localhost/api/feedback', { ref, fqdn: 'crumbly.com', vote: 1 }),
      s,
    );
    expect(res.status).toBe(204);
    await handleFeedback(
      req('http://localhost/api/feedback', { ref, fqdn: 'crumbly.com', vote: -1, reason: 'brand' }),
      s,
    );
    const votes = (s.feedback as MemoryFeedbackStore).votes;
    expect(votes.size).toBe(1);
    expect([...votes.values()]).toEqual([-1]);
    expect(JSON.stringify([...votes.keys()])).not.toContain('203.0.113.9'); // pseudonymous, never the IP
  });

  it('rejects forged links and bad votes', async () => {
    const s = svc();
    expect(
      (await handleFeedback(req('http://x/', { ref: 'x'.repeat(40), fqdn: 'crumbly.com', vote: 1 }), s))
        .status,
    ).toBe(404);
    expect(
      (await handleFeedback(req('http://x/', { ref: 'x'.repeat(40), fqdn: 'crumbly.com', vote: 5 }), s))
        .status,
    ).toBe(400);
  });
});

describe('find more in this range', () => {
  it('streams new names in the chosen band, without repeating shown ones', async () => {
    const s = svc();
    const first = await search(s);
    const shown = first.results.map((r) => r.fqdn);
    const ev = await events(
      await handleMore(
        req(`http://localhost/api/search/${first.ref}/more`, {
          description: DESCRIPTION,
          preferences: {},
          turnstileToken: 'token',
          priceMinCents: 1000,
          priceMaxCents: 5000,
          basis: 'upfront',
          exclude: shown.slice(0, 500),
        }),
        first.ref,
        s,
      ),
    );
    expect(ev.at(-1)!.event).toBe('done');
    const more = ev
      .filter((e) => e.event === 'batch')
      .flatMap((e) => (e.data as { results: ResultItem[] }).results);
    expect(more.length).toBeGreaterThan(0);
    for (const r of more) {
      expect(shown).not.toContain(r.fqdn);
      expect(r.price!.upfrontUsdCents).toBeGreaterThanOrEqual(1000);
      expect(r.price!.upfrontUsdCents).toBeLessThanOrEqual(5000);
    }
  });

  it('needs an existing search and a valid band', async () => {
    const s = svc();
    const bad = {
      description: DESCRIPTION,
      turnstileToken: 't',
      priceMinCents: 5000,
      priceMaxCents: 1000,
      exclude: [],
    };
    const { ref } = await search(s);
    expect((await handleMore(req('http://x/', bad), ref, s)).status).toBe(400);
    expect(
      (await handleMore(req('http://x/', { ...bad, priceMaxCents: null }), 'x'.repeat(40), s)).status,
    ).toBe(404);
  });
});
