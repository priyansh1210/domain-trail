// Spec 008 tech §11 `pair.test.ts`, `final-score.test.ts` and `reasons.test.ts` (FR-RANK-005, 006, 007, 010;
// NFR-RANK-003). Pairing and scoring share fixtures, so they live together.
import { describe, expect, it } from 'vitest';
import type { Ranked } from '../src/ranking/rounds';
import { fairOrder, finalScore, MAX_FQDNS, pair, reasonsFor, toIdeas, WEIGHTS } from '../src/ranking/score';

const ranked = (label: string, over: Partial<Ranked> = {}): Ranked => ({
  label,
  strategy: 'compound',
  sourceTerms: [],
  quality: 0.8,
  keywordCoverage: 0.5,
  flags: { segments: [label], realWords: 1, hasDigit: false, hasHyphen: false },
  R: 0.9,
  source: 'jev',
  ...over,
});
const fit = new Map([
  ['com', 0.6],
  ['shop', 1],
  ['cafe', 0.8],
  ['xyz', 0.2],
]);

describe('pairing (FR-RANK-005)', () => {
  it('pairs each name with its best extensions, preferred ones and its hack extension', () => {
    const pairs = pair([ranked('loafly'), ranked('cak', { strategy: 'hack', hackTld: 'es' })], fit, {
      preferredTlds: ['in'],
      perLabel: 2,
    });
    const fqdns = pairs.map((p) => p.fqdn);
    expect(fqdns).toEqual(expect.arrayContaining(['loafly.shop', 'loafly.cafe', 'loafly.in', 'cak.es']));
    expect(fqdns).not.toContain('loafly.xyz');
    expect(pairs.find((p) => p.fqdn === 'cak.es')!.T).toBe(1);
  });

  it('always offers .com and the local extension next to the best fits', () => {
    const fits = new Map([
      ['cafe', 1],
      ['kitchen', 0.95],
      ['menu', 0.9],
      ['com', 0.6],
      ['in', 0.4],
    ]);
    const fqdns = pair([ranked('loafly')], fits, {
      preferredTlds: [],
      perLabel: 2,
      anchors: ['com', 'in'],
    }).map((p) => p.fqdn);
    expect(fqdns.sort()).toEqual(['loafly.cafe', 'loafly.com', 'loafly.in', 'loafly.kitchen']);
  });

  it("takes extensions in turn, so a cap keeps every extension's best names", () => {
    const fits = new Map([
      ['cafe', 1],
      ['menu', 0.95],
      ['com', 0.6],
    ]);
    const pairs = pair([ranked('a', { R: 0.9 }), ranked('b', { R: 0.8 })], fits, { preferredTlds: [] });
    const order = fairOrder(pairs, (p) => p.ranked.R * p.T).map((p) => p.fqdn);
    expect(order.slice(0, 3)).toEqual(['a.cafe', 'a.menu', 'a.com']);
    expect(order.slice(3)).toEqual(['b.cafe', 'b.menu', 'b.com']);
  });

  it('caps the total at 300 pairs, keeping the strongest', () => {
    const many = Array.from({ length: 80 }, (_, i) => ranked(`name${i}`, { R: i / 80 }));
    const pairs = pair(many, fit, { preferredTlds: [] });
    expect(pairs.length).toBe(MAX_FQDNS);
    expect(pairs.some((p) => p.label === 'name79')).toBe(true);
    expect(pairs.some((p) => p.label === 'name0')).toBe(false);
  });
});

describe('final score (FR-RANK-006, 007)', () => {
  it('combines the signals with the configured weights and subtracts penalties', () => {
    const [p] = pair([ranked('loafly')], new Map([['shop', 1]]), { preferredTlds: [] });
    expect(finalScore(p!)).toBeCloseTo(WEIGHTS.R * 0.9 + WEIGHTS.Q * 0.8 + WEIGHTS.T * 1 + WEIGHTS.K * 0.5);
    expect(finalScore(p!, 1) - finalScore(p!)).toBeCloseTo(WEIGHTS.P);
    const [h] = pair(
      [ranked('loaf-24', { flags: { segments: ['loaf'], realWords: 1, hasDigit: true, hasHyphen: true } })],
      new Map([['shop', 1]]),
      { preferredTlds: [] },
    );
    expect(finalScore(p!) - finalScore(h!)).toBeCloseTo(0.1);
  });
});

describe('reasons (FR-RANK-010, NFR-RANK-003)', () => {
  const ctx = { coreTerms: new Map([['loaf', 0.4]]), flagsOn: ['feat_food'], geo: 'country_in' };

  it('gives 1–3 reasons whose triggers hold', () => {
    const r = ranked('loafly', {
      flags: { segments: ['loaf', 'ly'], realWords: 1, hasDigit: false, hasHyphen: false },
    });
    const [shop] = pair([r], new Map([['cafe', 0.9]]), { preferredTlds: [] });
    const reasons = reasonsFor(shop!, ctx);
    expect(reasons.length).toBeGreaterThanOrEqual(1);
    expect(reasons.length).toBeLessThanOrEqual(3);
    for (const reason of reasons) {
      if (reason.id === 'keyword') expect(r.keywordCoverage).toBeGreaterThanOrEqual(0.3);
      if (reason.id === 'excellent_fit') expect(r.R).toBeGreaterThanOrEqual(0.85);
      if (reason.id === 'short') expect(r.label.length).toBeLessThanOrEqual(8);
      if (reason.id === 'tld_fit') expect(shop!.T).toBeGreaterThanOrEqual(0.7);
    }
    expect(reasons.map((x) => x.id)).toEqual(['keyword', 'excellent_fit', 'short']);
  });

  it('explains local extensions and .com', () => {
    const r = ranked('zzname', { keywordCoverage: 0, R: 0.5, quality: 0.5 });
    expect(
      reasonsFor(pair([r], new Map([['in', 0.5]]), { preferredTlds: [] })[0]!, ctx).map((x) => x.id),
    ).toContain('local');
    expect(
      reasonsFor(pair([r], new Map([['com', 0.6]]), { preferredTlds: [] })[0]!, ctx).map((x) => x.id),
    ).toContain('tld_trust');
  });

  it('groups pairs into ideas with their best three extensions', () => {
    const ideas = toIdeas(
      pair([ranked('loafly'), ranked('crumbcraft', { R: 0.5 })], fit, { preferredTlds: [] }),
      ctx,
    );
    expect(ideas[0]!.label).toBe('loafly');
    expect(ideas[0]!.tlds.map((t) => t.tld)).toEqual(['shop', 'cafe', 'com']);
  });

  it('keeps the list varied: at most 3 ideas per key word and no style above 40 % of the top 20 (FR-RANK-009)', () => {
    const many = [
      ...Array.from({ length: 10 }, (_, i) =>
        ranked(`booking${i}`, { sourceTerms: ['booking'], R: 0.95 - i / 100, strategy: 'affix' }),
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        ranked(`wedding${i}`, { sourceTerms: ['wedding'], R: 0.7 - i / 100, strategy: 'compound' }),
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        ranked(`lens${i}`, { sourceTerms: ['lens'], R: 0.6 - i / 100, strategy: 'brandable' }),
      ),
    ];
    const ideas = toIdeas(
      pair(many, fit, { preferredTlds: [] }),
      {
        coreTerms: new Map([
          ['booking', 0.4],
          ['wedding', 0.3],
          ['lens', 0.2],
        ]),
        flagsOn: [],
        geo: 'global',
      },
      12,
    );
    const top = ideas.slice(0, 9);
    expect(top.filter((i) => i.label.startsWith('booking'))).toHaveLength(3);
    expect(top.filter((i) => i.label.startsWith('wedding'))).toHaveLength(3);
    expect(ideas).toHaveLength(12); // topped up when the rules run out of variety
  });
});
