// Spec 001 tech §11 `search-route.int.test.ts` and `idempotency.int.test.ts` (FR-INT-006, 008, 012; FR-ABU-001,
// 002, 009, 011) — the route runs against in-memory services and the mock decision model.
import { parseServerEnv } from '@domains-all/config';
import type { ResultItem } from '@domains-all/core';
import { describe, expect, it } from 'vitest';
import { handleSearch, handleSnapshot } from './search';
import { buildServices, type Services } from './services';
import { MemorySearchStore } from './store';

const DESCRIPTION = 'Online bakery in Pune delivering sourdough bread and cakes to families';
let n = 0;
const body = (over: Record<string, unknown> = {}) => ({
  description: DESCRIPTION,
  preferences: {},
  turnstileToken: 'token',
  clientRequestId: `0190f5a8-0000-7000-8000-${String(++n).padStart(12, '0')}`,
  ...over,
});
const post = (b: unknown, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/search', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'vitest',
      'x-forwarded-for': '203.0.113.7',
      ...headers,
    },
    body: typeof b === 'string' ? b : JSON.stringify(b),
  });

async function events(res: Response): Promise<Array<{ event: string; data: unknown }>> {
  const text = await res.text();
  return text
    .split('\n\n')
    .filter((block) => block.startsWith('event:'))
    .map((block) => {
      const [e, d] = block.split('\n');
      return { event: e!.slice(7), data: JSON.parse(d!.slice(6)) };
    });
}

function svc(env: Record<string, string> = {}): Services {
  // Recorded DNS/RDAP/price answers: tests never go online (FR-QA-003).
  return buildServices(parseServerEnv({ RATE_LIMIT_MODE: 'off', PUBLIC_DATA_MODE: 'fixture', ...env }));
}

const resultsOf = (ev: Array<{ event: string; data: unknown }>) =>
  ev.filter((e) => e.event === 'batch').flatMap((e) => (e.data as { results: ResultItem[] }).results);
const LDH_FQDN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9-]+){1,3}$/;

describe('POST /api/search', () => {
  it('streams features, then checked and priced results in sections', async () => {
    const s = svc();
    const res = await handleSearch(post(body()), s);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const ev = await events(res);
    const kinds = ev.map((e) => e.event);
    expect(kinds.slice(0, 6)).toEqual([
      'search_created',
      'progress',
      'features',
      'progress',
      'progress',
      'pricing',
    ]);
    expect(kinds).toContain('batch');
    expect(kinds.at(-1)).toBe('done');
    const results = resultsOf(ev);
    expect(results.length).toBeGreaterThan(10);
    for (const r of results) {
      expect(r.fqdn).toMatch(LDH_FQDN);
      expect(r.status).not.toBe('taken'); // taken names are never shown (FR-AVL-001)
      if (['budget', 'mid', 'premium'].includes(r.section))
        expect(r.price?.upfrontUsdCents).toBeGreaterThan(0);
    }
    const done = ev.at(-1)!.data as { counts: Record<string, number>; sections: Record<string, string[]> };
    expect(done.counts.budget).toBeGreaterThan(0);
    expect(done.sections.budget!.length).toBe(done.counts.budget);
    const created = ev[0]!.data as { ref: string; cached: boolean };
    expect(created.cached).toBe(false);
    expect((ev[2]!.data as { geo: { value: string } }).geo.value).toBe('country_in');
  });

  it('never stores the description (FR-INT-012, FR-DATA-002)', async () => {
    const s = svc();
    await events(await handleSearch(post(body()), s));
    const store = s.store as MemorySearchStore;
    const saved = JSON.stringify([...store.searches.values()]);
    expect(saved).not.toContain('sourdough bread');
    expect(saved).not.toContain('Pune');
    expect(store.searches.size).toBe(1);
  });

  it('replays an identical search from the cache (FR-INT-008)', async () => {
    const s = svc();
    const first = await events(await handleSearch(post(body()), s));
    const second = await events(await handleSearch(post(body()), s));
    expect(second.map((e) => e.event)).toEqual(['search_created', 'features', 'pricing', 'batch', 'done']);
    expect(
      resultsOf(second)
        .map((r) => r.fqdn)
        .sort(),
    ).toEqual(
      resultsOf(first)
        .map((r) => r.fqdn)
        .sort(),
    );
    expect((second[0]!.data as { cached: boolean; searchId: string }).cached).toBe(true);
    expect((second[0]!.data as { searchId: string }).searchId).toBe(
      (first[0]!.data as { searchId: string }).searchId,
    );
  });

  it('serves the snapshot for the share link and rejects forged links', async () => {
    const s = svc();
    const ev = await events(await handleSearch(post(body()), s));
    const ref = (ev[0]!.data as { ref: string }).ref;
    const snap = await handleSnapshot(ref, s);
    expect(snap.status).toBe(200);
    const json = (await snap.json()) as {
      status: string;
      profile: { industry: { value: string } };
      results: ResultItem[];
      sections: Record<string, string[]>;
      pricing: { fx: { rates: Record<string, number> } };
    };
    expect(json.status).toBe('done');
    expect(json.results.length).toBe(resultsOf(ev).length);
    expect(json.sections.budget!.length).toBeGreaterThan(0);
    expect(json.pricing.fx.rates.USD).toBe(1);
    expect(json.profile.industry.value).toBe('food__bakery');
    expect(JSON.stringify(json)).not.toContain('sourdough bread');
    expect((await handleSnapshot(`${ref.slice(0, 36)}.deadbeef`, s)).status).toBe(404);
  });

  it('asks for detail on vague text and refuses harmful requests', async () => {
    const s = svc();
    const vague = await events(
      await handleSearch(post(body({ description: 'my new website idea here' })), s),
    );
    expect(vague.map((e) => e.event)).toEqual(['search_created', 'progress', 'needs_detail']);
    const bad = await events(
      await handleSearch(
        post(body({ description: 'A fake login page that looks like my bank website to collect passwords' })),
        s,
      ),
    );
    expect(bad.map((e) => e.event)).toEqual(['search_created', 'progress', 'refused']);
  });

  it('rejects invalid input with field messages and oversized bodies', async () => {
    const s = svc();
    const short = await handleSearch(post(body({ description: 'too short' })), s);
    expect(short.status).toBe(400);
    expect(((await short.json()) as { fields: Record<string, string> }).fields.description).toBeTruthy();
    expect((await handleSearch(post('{not json'), s)).status).toBe(400);
    expect((await handleSearch(post(body({ description: 'x'.repeat(17_000) })), s)).status).toBe(413);
  });

  it('refuses a duplicate submit with the earlier reference (idempotency)', async () => {
    const s = svc();
    const b = body();
    const first = await events(await handleSearch(post(b), s));
    const dup = await handleSearch(post(b), s);
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as { ref: string }).ref).toBe((first[0]!.data as { ref: string }).ref);
  });

  it('limits searches per visitor and says when to retry (FR-ABU-002, FR-ABU-011)', async () => {
    const s = svc({ RATE_LIMIT_MODE: 'enforce' });
    for (let i = 0; i < 5; i++) {
      const r = await handleSearch(post(body({ description: `${DESCRIPTION} number ${i}` })), s);
      expect(r.status).toBe(200);
      await r.text();
    }
    const limited = await handleSearch(post(body()), s);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(((await limited.json()) as { retryAfterSec: number }).retryAfterSec).toBeGreaterThan(0);
    // another visitor is unaffected
    expect((await handleSearch(post(body(), { 'x-forwarded-for': '198.51.100.1' }), s)).status).toBe(200);
  });

  it('ignores RATE_LIMIT_MODE=off outside mock mode', () => {
    expect(svc({ MOCK_EXTERNALS: '0' }).limitsEnforced).toBe(true);
  });

  it('blocks failed human checks and refuses to run live without secrets', async () => {
    const s = svc();
    const failing: Services = { ...s, verifyHuman: async () => 'failed' };
    expect((await handleSearch(post(body()), failing)).status).toBe(403);
    const live = svc({ MOCK_EXTERNALS: '0' });
    expect((await handleSearch(post(body()), live)).status).toBe(503);
  });

  it('keeps searching when storage is down and says results cannot be shared', async () => {
    const s = svc();
    const broken = new MemorySearchStore();
    broken.createSearch = async () => {
      throw new Error('db down');
    };
    const ev = await events(await handleSearch(post(body()), { ...s, store: broken }));
    const kinds = ev.map((e) => e.event);
    expect(kinds.slice(0, 7)).toEqual([
      'search_created',
      'notice',
      'progress',
      'features',
      'progress',
      'progress',
      'pricing',
    ]);
    expect(kinds.at(-1)).toBe('done');
    expect((ev[1]!.data as { code: string }).code).toBe('not_saved');
  });
});
