// Spec 006 tech §11 `porkbun-adapter.test.ts` (FR-PRC-001, 011, 017, NFR-PRC-004): parsing, sanity checks, buy
// links; the in-memory price source refreshes every 12 hours and keeps old data when a refresh fails.
import { describe, expect, it, vi } from 'vitest';
import { createPriceSource, isStale, snapshotBook } from '../src/book';
import { parseFrankfurter, parsePorkbun, PORKBUN } from '../src/sources';

const porkbun = (n = 400, com = '11.08') => ({
  status: 'SUCCESS',
  pricing: {
    com: { registration: com, renewal: com, transfer: com },
    shop: { registration: '2.06', renewal: '31.41' },
    ...Object.fromEntries(
      Array.from({ length: n }, (_, i) => [`t${i}`, { registration: '9.99', renewal: '12.00' }]),
    ),
  },
});

describe('Porkbun price list', () => {
  it('parses prices into cents', () => {
    const prices = parsePorkbun(porkbun());
    expect(prices.get('com')).toEqual({ registerCents: 1108, renewCents: 1108 });
    expect(prices.get('shop')).toEqual({ registerCents: 206, renewCents: 3141 });
  });

  it('rejects answers that fail the sanity check', () => {
    expect(() => parsePorkbun(porkbun(10))).toThrow();
    expect(() => parsePorkbun(porkbun(400, '95.00'))).toThrow();
    expect(() => parsePorkbun({ status: 'ERROR' })).toThrow();
  });

  it('links to the exact name without tracking parameters', () => {
    expect(PORKBUN.buyUrl('crumbly.com')).toBe('https://porkbun.com/checkout/search?q=crumbly.com');
  });

  it('parses FX rates with USD as the base', () => {
    const fx = parseFrankfurter({
      base: 'USD',
      date: '2026-10-02',
      rates: Object.fromEntries(
        'EUR GBP JPY INR CNY CAD AUD CHF SGD SEK'.split(' ').map((c, i) => [c, i + 1]),
      ),
    });
    expect(fx.rates.USD).toBe(1);
    expect(fx.rates.JPY).toBe(3);
  });
});

describe('price source', () => {
  it('answers from the snapshot at once and refreshes in the background in live mode', async () => {
    let now = Date.parse('2026-10-04T00:00:00Z');
    const fetchFn = vi.fn(async (url: string) =>
      Response.json(
        url.includes('porkbun')
          ? porkbun(400, '12.00')
          : {
              base: 'USD',
              date: '2026-10-03',
              rates: Object.fromEntries(
                'EUR GBP JPY INR CNY CAD AUD CHF SGD SEK'.split(' ').map((c) => [c, 2]),
              ),
            },
      ),
    );
    const source = createPriceSource({
      live: true,
      fetchFn: fetchFn as unknown as typeof fetch,
      now: () => now,
    });
    expect(source.get().prices.get('com')!.registerCents).toBe(
      snapshotBook().prices.get('com')!.registerCents,
    );
    await source.settled();
    expect(source.get().prices.get('com')!.registerCents).toBe(1200);
    expect(source.get().fx.asOf).toBe('2026-10-03');
    expect(fetchFn).toHaveBeenCalledTimes(2);
    now += 60 * 60_000;
    source.get();
    expect(fetchFn).toHaveBeenCalledTimes(2); // not again within 12 hours
  });

  it('keeps the previous data when the refresh fails, and never goes online in fixture mode', async () => {
    const down = vi.fn(async () => new Response('', { status: 503 }));
    const live = createPriceSource({ live: true, fetchFn: down as unknown as typeof fetch });
    live.get();
    await live.settled();
    expect(live.get().prices.size).toBeGreaterThan(300);
    const offline = vi.fn();
    createPriceSource({ live: false, fetchFn: offline as unknown as typeof fetch }).get();
    expect(offline).not.toHaveBeenCalled();
  });

  it('reports when prices were fetched and why a refresh failed', async () => {
    const down = vi.fn(async (url: string) =>
      url.includes('porkbun')
        ? new Response('', { status: 403 })
        : Response.json({
            base: 'USD',
            date: '2026-10-03',
            rates: Object.fromEntries(
              'EUR GBP JPY INR CNY CAD AUD CHF SGD SEK'.split(' ').map((c) => [c, 2]),
            ),
          }),
    );
    const source = createPriceSource({ live: true, fetchFn: down as unknown as typeof fetch });
    expect(source.status().lastRefresh).toBeUndefined();
    source.get();
    await source.settled();
    const st = source.status();
    expect(st.lastRefresh).toMatchObject({ ok: false, pricesError: expect.stringContaining('403') });
    expect(st.fxAsOf).toBe('2026-10-03');
    expect(st.pricesAt).toBe(snapshotBook().pricesAt); // the snapshot stays in use
  });

  it('marks prices older than 30 hours as stale', () => {
    const book = { ...snapshotBook(), pricesAt: '2026-10-01T00:00:00Z' };
    expect(isStale(book, Date.parse('2026-10-02T05:00:00Z'))).toBe(false);
    expect(isStale(book, Date.parse('2026-10-02T07:00:00Z'))).toBe(true);
  });
});
