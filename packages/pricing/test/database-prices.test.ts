// tasks/M5-freshness.md E1 (FR-PRC-011, FR-REF-002): the server prefers the daily price job's tables, asks Porkbun
// only when that copy is missing or old, and keeps the snapshot when everything fails.
import { describe, expect, it } from 'vitest';
import priceSnapshot from '../data/porkbun-prices.json';
import { createPriceSource, loadDatabasePrices } from '../src';

const DB = { url: 'https://db.example.supabase.co', anonKey: 'public-key' };
const NOW = Date.parse('2026-10-10T08:00:00Z');

const rows = Object.entries(priceSnapshot.prices as unknown as Record<string, [number, number]>).map(
  ([tld, [register_cents, renew_cents]]) => ({ tld, register_cents, renew_cents }),
);

function server(opts: { pricesAt?: string; dbDown?: boolean; porkbun?: 'ok' | 'down' }) {
  const calls: string[] = [];
  const fetchFn = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url.host); // hosts asked, compared exactly
    if (url.host === 'db.example.supabase.co') {
      if (opts.dbDown) return new Response('{}', { status: 503 });
      if (url.pathname.endsWith('/tld_prices')) {
        const offset = Number(url.searchParams.get('offset'));
        const page = rows
          .sort((a, b) => (a.tld < b.tld ? -1 : 1))
          .slice(offset, offset + 1000)
          .map((r) => ({ ...r, fetched_at: opts.pricesAt ?? '2026-10-10T01:00:05+00:00' }));
        return Response.json(page);
      }
      return Response.json([
        { quote: 'EUR', rate: 0.91, as_of: '2026-10-09' },
        { quote: 'INR', rate: 88.1, as_of: '2026-10-09' },
        ...['GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'CNY', 'SEK', 'NZD', 'SGD'].map((q) => ({
          quote: q,
          rate: 1.5,
          as_of: '2026-10-09',
        })),
      ]);
    }
    if (url.host === 'api.porkbun.com') {
      if (opts.porkbun !== 'ok') return new Response('down', { status: 503 });
      const pricing = Object.fromEntries(
        rows.map((r) => [r.tld, { registration: '12.00', renewal: '12.00' }]),
      );
      return Response.json({ status: 'SUCCESS', pricing });
    }
    return Response.json({
      base: 'USD',
      date: '2026-10-09',
      rates: {
        EUR: 0.9,
        INR: 88,
        GBP: 0.8,
        JPY: 150,
        AUD: 1.5,
        CAD: 1.4,
        CHF: 0.9,
        CNY: 7,
        SEK: 10,
        NZD: 1.7,
      },
    });
  }) as typeof fetch;
  return { calls, fetchFn };
}

describe('database price list', () => {
  it('reads every page and checks the list is sane', async () => {
    const { fetchFn } = server({});
    const { prices, pricesAt } = await loadDatabasePrices(DB, fetchFn);
    expect(prices.size).toBe(rows.length);
    expect(prices.get('com')).toEqual({ registerCents: 1108, renewCents: 1108 });
    expect(pricesAt).toBe('2026-10-10T01:00:05.000Z');
  });
});

describe('createPriceSource with the database', () => {
  it('uses a fresh database copy without asking Porkbun', async () => {
    const { calls, fetchFn } = server({});
    const src = createPriceSource({ live: true, fetchFn, now: () => NOW, database: DB });
    const book = await src.ensureFresh(5000);
    expect(book.pricesAt).toBe('2026-10-10T01:00:05.000Z');
    expect(book.fx.asOf).toBe('2026-10-09');
    expect(book.fx.rates.INR).toBe(88.1);
    expect(src.status()).toMatchObject({ source: 'database', lastRefresh: { ok: true } });
    expect(calls.includes('api.porkbun.com')).toBe(false);
  });

  it('asks Porkbun when the database copy is old', async () => {
    const { calls, fetchFn } = server({ pricesAt: '2026-10-08T01:00:00Z', porkbun: 'ok' });
    const src = createPriceSource({ live: true, fetchFn, now: () => NOW, database: DB });
    const book = await src.ensureFresh(5000);
    expect(calls.includes('api.porkbun.com')).toBe(true);
    expect(src.status().source).toBe('porkbun');
    expect(book.prices.get('com')?.registerCents).toBe(1200);
  });

  it('keeps an old database copy when Porkbun is unreachable (better than the snapshot)', async () => {
    const { fetchFn } = server({ pricesAt: '2026-10-08T01:00:00Z', porkbun: 'down' });
    const src = createPriceSource({ live: true, fetchFn, now: () => NOW, database: DB });
    const book = await src.ensureFresh(5000);
    expect(book.pricesAt).toBe('2026-10-08T01:00:00.000Z');
    expect(src.status().source).toBe('database');
  });

  it('falls back to the snapshot and explains why when nothing answers', async () => {
    const { fetchFn } = server({ dbDown: true, porkbun: 'down' });
    const src = createPriceSource({ live: true, fetchFn, now: () => NOW, database: DB });
    const book = await src.ensureFresh(5000);
    expect(book.pricesAt).toBe(priceSnapshot.fetchedAt);
    const status = src.status();
    expect(status.source).toBe('snapshot');
    expect(status.lastRefresh?.ok).toBe(false);
    expect(status.lastRefresh?.pricesError).toMatch(/database: .*503.*porkbun/i);
  });
});
