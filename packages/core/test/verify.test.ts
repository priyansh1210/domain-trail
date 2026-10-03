// Stages S7–S9 (spec 005 FR-AVL-006, spec 006 FR-PRC-003, spec 008 FR-RANK-006–009): taken names removed, prices
// and sections, availability penalties, streamed batches, variety per section, free names in parallel.
import type { Checker, CheckResult, CheckStatus } from '@domains-all/availability';
import { makeResult } from '@domains-all/availability';
import type { FreeChecker } from '@domains-all/free-domains';
import { type PriceBook, snapshotBook } from '@domains-all/pricing';
import { describe, expect, it } from 'vitest';
import { shape } from '../src/generation/quality';
import type { Pair } from '../src/ranking/score';
import {
  orderSection,
  priceValue,
  type ResultItem,
  runVerify,
  type VerifyContext,
} from '../src/pipeline/verify';

const prices: PriceBook = {
  ...snapshotBook(),
  prices: new Map([
    ['com', { registerCents: 1108, renewCents: 1108 }],
    ['shop', { registerCents: 206, renewCents: 3141 }],
    ['ai', { registerCents: 8270, renewCents: 8270 }],
    ['io', { registerCents: 2812, renewCents: 5180 }],
  ]),
};

function pairOf(label: string, tld: string, R = 0.8, strategy = 'compound'): Pair {
  return {
    label,
    tld,
    fqdn: `${label}.${tld}`,
    T: tld === 'com' ? 1 : 0.7,
    ranked: {
      label,
      strategy: strategy as Pair['ranked']['strategy'],
      sourceTerms: [label],
      quality: 0.8,
      keywordCoverage: 0.5,
      flags: shape(label),
      R,
      source: 'deterministic',
    },
  };
}

/** Checker that answers from a table and streams each result. */
function fakeChecker(statuses: Record<string, CheckStatus>): Checker {
  return {
    async checkMany(fqdns, ctx) {
      const results: CheckResult[] = fqdns.map((f) =>
        makeResult(f, f.slice(f.indexOf('.') + 1), statuses[f] ?? 'available', 'rdap', Date.now()),
      );
      for (const r of results) ctx.onResult?.(r);
      return {
        results,
        stats: { cached: 0, dohQueries: 0, rdapRequests: 0, late: 0, paused: false, byStatus: {} },
      };
    },
    recheckOne: async (f) => makeResult(f, 'com', 'available', 'rdap', Date.now()),
  };
}

const freeChecker: FreeChecker = {
  check: async (_l, p) => (p.checkMethod === 'none' ? 'not_verifiable' : 'appears_free'),
};

const ctx = (
  pairs: Pair[],
  statuses: Record<string, CheckStatus> = {},
  extra: Partial<VerifyContext> = {},
): VerifyContext => ({
  pairs,
  coreTerms: new Map([['crumb', 1]]),
  flagsOn: ['feat_food'],
  geo: 'global',
  siteType: 'online_store',
  sensitive: false,
  includeFree: true,
  allowHyphens: false,
  checker: fakeChecker(statuses),
  freeChecker,
  prices,
  deadline: Date.now() + 5000,
  ...extra,
});

describe('verify stage', () => {
  it('drops taken names and puts the rest in price sections or "Price at registrar"', async () => {
    const pairs = [
      pairOf('crumbly', 'com'),
      pairOf('crumbly', 'shop'),
      pairOf('crumbly', 'ai'),
      pairOf('crumbly', 'fr'),
      pairOf('taken', 'com'),
    ];
    const out = await runVerify(ctx(pairs, { 'taken.com': 'taken' }, { includeFree: false }));
    const by = Object.fromEntries(out.results.map((r) => [r.fqdn, r]));
    expect(by['taken.com']).toBeUndefined();
    expect(by['crumbly.com']).toMatchObject({
      section: 'budget',
      price: { upfrontUsdCents: 1108, source: 'Porkbun' },
    });
    expect(by['crumbly.ai']).toMatchObject({
      section: 'mid',
      price: { upfrontUsdCents: 16_540, minYears: 2 },
    });
    expect(by['crumbly.fr']).toMatchObject({ section: 'unpriced', restriction: { kind: 'local_presence' } });
    expect(by['crumbly.fr']!.price).toBeUndefined();
    expect(out.sections.budget).toEqual(expect.arrayContaining(['crumbly.com', 'crumbly.shop']));
  });

  it('ranks unconfirmed and "likely available" names below confirmed ones', async () => {
    const pairs = [pairOf('crumbly', 'com'), pairOf('loafly', 'com'), pairOf('doughly', 'com')];
    const out = await runVerify(
      ctx(pairs, { 'loafly.com': 'unknown', 'doughly.com': 'likely_available' }, { includeFree: false }),
    );
    expect(out.sections.budget).toEqual(['crumbly.com', 'doughly.com', 'loafly.com']);
  });

  it('streams results in batches and adds free names from suitable providers', async () => {
    const batches: ResultItem[][] = [];
    const pairs = Array.from({ length: 25 }, (_, i) => pairOf(`crumb${String.fromCharCode(97 + i)}`, 'com'));
    const out = await runVerify(ctx(pairs, {}, { onBatch: (b) => batches.push(b) }));
    expect(batches.length).toBeGreaterThanOrEqual(3);
    expect(out.stats.free).toBeGreaterThan(0);
    const free = out.results.filter((r) => r.section === 'free');
    expect(free.every((r) => r.free?.conditions.steps.length)).toBe(true);
    expect(free.map((r) => r.free!.providerId)).not.toContain('is-a-dev'); // a shop is not a developer project
  });

  it('keeps at most 3 extensions per name and varies styles on the first page', () => {
    const items = ['com', 'shop', 'io', 'ai', 'xyz'].map(
      (tld, i) =>
        ({ fqdn: `crumbly.${tld}`, label: 'crumbly', strategy: 'compound', score: 1 - i / 10 }) as ResultItem,
    );
    expect(orderSection(items)).toEqual(['crumbly.com', 'crumbly.shop', 'crumbly.io']);
    const many = Array.from(
      { length: 30 },
      (_, i) =>
        ({
          fqdn: `n${i}.com`,
          label: `n${i}`,
          strategy: i < 25 ? 'affix' : 'blend',
          score: 1 - i / 100,
        }) as ResultItem,
    );
    const firstPage = orderSection(many).slice(0, 20);
    expect(firstPage.filter((f) => Number(f.slice(1, -4)) < 25).length).toBe(15); // 8 affix + top-up after the 5 blends
    expect(firstPage).toEqual(expect.arrayContaining(['n25.com', 'n29.com']));
  });

  it('scores price value within each section', () => {
    expect(priceValue('budget', 1)).toBe(1);
    expect(priceValue('budget', 10_000)).toBe(0);
    expect(priceValue('mid', 20_000)).toBeCloseTo(0.5, 2);
    expect(priceValue('premium', 30_001)).toBeCloseTo(1, 3);
    expect(priceValue('premium', 300_000)).toBeCloseTo(0.5, 3);
  });
});
