// Spec 006 tech §5.4 and spec 009 tech §5 (FR-PRC-006, 007, 008, 010, 016, 018; FR-UX-018): filtering, ordering,
// sorting, URL state and default currency on the results page.
import type { ResultItem } from '@domains-all/core/client';
import { describe, expect, it } from 'vitest';
import {
  ago,
  DEFAULT_FILTERS,
  defaultCurrency,
  filtersFromParams,
  paramsFromFilters,
  passes,
  sectionItems,
} from './results';

const item = (
  fqdn: string,
  section: ResultItem['section'],
  upfront?: number,
  extra: Partial<ResultItem> = {},
): ResultItem => ({
  fqdn,
  label: fqdn.split('.')[0]!,
  tld: fqdn.slice(fqdn.indexOf('.') + 1),
  section,
  status: 'available',
  checkedAt: '2026-10-04T00:00:00Z',
  score: 0.5,
  reasons: [],
  strategy: 'compound',
  source: 'deterministic',
  ...(upfront === undefined
    ? {}
    : {
        price: {
          upfrontUsdCents: upfront,
          firstYearUsdCents: upfront,
          renewUsdCents: upfront * 2,
          minYears: 1,
          source: 'Porkbun',
          buyUrl: '#',
          premium: false,
          premiumPossible: false,
          renewWarning: false,
        },
      }),
  ...extra,
});

describe('price filter', () => {
  it('filters priced results, keeps free names only from $0, never hides "price at registrar"', () => {
    const f = { ...DEFAULT_FILTERS, min: 10, max: 50 };
    expect(passes(item('a.com', 'budget', 1108), f)).toBe(true);
    expect(passes(item('a.shop', 'budget', 206), f)).toBe(false);
    expect(passes(item('a.is-a.dev', 'free'), f)).toBe(false);
    expect(passes(item('a.is-a.dev', 'free'), DEFAULT_FILTERS)).toBe(true);
    expect(passes(item('a.is-a.dev', 'free'), { ...DEFAULT_FILTERS, includeFree: false })).toBe(false);
    expect(passes(item('a.fr', 'unpriced'), f)).toBe(true);
  });

  it('can filter by the renewal price instead', () => {
    expect(passes(item('a.com', 'budget', 2000), { ...DEFAULT_FILTERS, min: 0, max: 30 })).toBe(true);
    expect(
      passes(item('a.com', 'budget', 2000), { ...DEFAULT_FILTERS, min: 0, max: 30, basis: 'renewal' }),
    ).toBe(false);
  });
});

describe('section order and sorting', () => {
  const results = Object.fromEntries(
    [
      item('crumb.com', 'budget', 1108, { score: 0.9 }),
      item('crumb.shop', 'budget', 206, { score: 0.8 }),
      item('crumb.io', 'budget', 2812, { score: 0.7 }),
      item('crumb.xyz', 'budget', 204, { score: 0.6 }),
      item('loaf.com', 'budget', 1108, { score: 0.65 }),
    ].map((r) => [r.fqdn, r]),
  );

  it('uses the final order when known, and caps names at 3 extensions while streaming', () => {
    expect(
      sectionItems('budget', results, ['loaf.com', 'crumb.com'], DEFAULT_FILTERS)
        .map((r) => r.fqdn)
        .slice(0, 2),
    ).toEqual(['loaf.com', 'crumb.com']);
    expect(sectionItems('budget', results, undefined, DEFAULT_FILTERS).map((r) => r.fqdn)).toEqual([
      'crumb.com',
      'crumb.shop',
      'crumb.io',
      'loaf.com',
    ]);
  });

  it('sorts by price or by length on request', () => {
    expect(sectionItems('budget', results, undefined, { ...DEFAULT_FILTERS, sort: 'price' })[0]!.fqdn).toBe(
      'crumb.shop',
    );
    expect(sectionItems('budget', results, undefined, { ...DEFAULT_FILTERS, sort: 'short' })[0]!.fqdn).toBe(
      'crumb.io',
    );
  });
});

describe('page address and currency', () => {
  it('round-trips the filters through the URL and swaps a reversed range', () => {
    const f = {
      ...DEFAULT_FILTERS,
      min: 10,
      max: 50,
      basis: 'renewal' as const,
      sort: 'price' as const,
      cur: 'JPY',
    };
    expect(filtersFromParams(new URLSearchParams(paramsFromFilters(f)))).toMatchObject(f);
    expect(filtersFromParams(new URLSearchParams('min=300&max=100'))).toMatchObject({ min: 100, max: 300 });
    expect(filtersFromParams(new URLSearchParams('max=max')).max).toBe(Number.POSITIVE_INFINITY);
    expect(paramsFromFilters(DEFAULT_FILTERS)).toBe('');
  });

  it('defaults to the currency of the browser region when a rate exists', () => {
    const rates = { USD: 1, JPY: 157, INR: 96, EUR: 0.89 };
    expect(defaultCurrency(['ja-JP'], rates)).toBe('JPY');
    expect(defaultCurrency(['en-IN', 'en'], rates)).toBe('INR');
    expect(defaultCurrency(['de-DE'], rates)).toBe('EUR');
    expect(defaultCurrency(['en'], rates)).toBe('USD');
    expect(defaultCurrency(['pt-BR'], rates)).toBe('USD'); // no BRL rate here
  });

  it('says how long ago a name was checked', () => {
    const now = Date.parse('2026-10-04T12:00:00Z');
    expect(ago('2026-10-04T11:59:30Z', now)).toEqual({ key: 'justNow', n: 0 });
    expect(ago('2026-10-04T11:57:00Z', now)).toEqual({ key: 'minutes', n: 3 });
    expect(ago('2026-10-04T09:00:00Z', now)).toEqual({ key: 'hours', n: 3 });
    expect(ago('2026-10-01T12:00:00Z', now)).toEqual({ key: 'days', n: 3 });
  });
});
