// Spec 008 tech §11 `rank.perf.test.ts` (NFR-RANK-002): pairing, scoring and reasons for 300 pairs < 50 ms.
import { describe, expect, it } from 'vitest';
import type { Ranked } from '../src/ranking/rounds';
import { pair, toIdeas } from '../src/ranking/score';

describe('scoring speed', () => {
  it('scores 300 pairs and builds ideas quickly', () => {
    const ranked: Ranked[] = Array.from({ length: 45 }, (_, i) => ({
      label: `name${i}`,
      strategy: 'compound',
      sourceTerms: [],
      quality: 0.7,
      keywordCoverage: 0.4,
      flags: { segments: [`name${i}`], realWords: 1, hasDigit: false, hasHyphen: false },
      R: 0.5 + i / 100,
      source: 'jev',
    }));
    const fit = new Map(
      ['com', 'shop', 'store', 'cafe', 'kitchen', 'online', 'site', 'xyz'].map((t, i) => [t, 1 - i / 10]),
    );
    const t0 = performance.now();
    const pairs = pair(ranked, fit, { preferredTlds: ['in'] });
    toIdeas(pairs, { coreTerms: new Map([['name', 0.3]]), flagsOn: [], geo: 'global' });
    expect(performance.now() - t0).toBeLessThan(50);
    expect(pairs.length).toBe(300);
  });
});
