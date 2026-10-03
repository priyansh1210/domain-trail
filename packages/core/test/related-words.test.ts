// Spec 004 tech §11 `related-words.test.ts` (FR-GEN-003, FR-GEN-018, NFR-GEN-002).
import { describe, expect, it, vi } from 'vitest';
import { expansionOptions, keepExpansions, MemoryWordCache, relatedWords } from '../src/generation/related';
import { extractTerms, weighTerms } from '../src/generation/terms';

const core = weighTerms(extractTerms('Online bakery delivering sourdough bread and cakes'));

function datamuse(words: string[]) {
  return vi.fn(async (_url: string) => Response.json(words.map((word, i) => ({ word, score: 1000 - i }))));
}

describe('relatedWords', () => {
  it('uses Datamuse in live mode with single words, at most 15 calls', async () => {
    const fetchFn = datamuse(['loaf', 'pastry', 'crust', 'google', 'xqzv']);
    const r = await relatedWords(core, { live: true, fetchFn: fetchFn as unknown as typeof fetch });
    expect(r.calls).toBeLessThanOrEqual(15);
    for (const [url] of fetchFn.mock.calls) {
      const term = [...new URL(url).searchParams.values()][0]!;
      expect(term).toMatch(/^[a-z]+$/); // never the description
    }
    const words = r.expansions.map((e) => e.word);
    expect(words).toEqual(expect.arrayContaining(['loaf', 'pastry', 'crust']));
    expect(words).not.toContain('google'); // brand
    expect(words).not.toContain('xqzv'); // not a word
    expect(r.expansions.every((e) => e.source === 'datamuse')).toBe(true);
  });

  it('caches answers so a repeat search makes no calls', async () => {
    const cache = new MemoryWordCache();
    await relatedWords(core, { live: true, fetchFn: datamuse(['loaf']) as unknown as typeof fetch, cache });
    const again = vi.fn();
    const r = await relatedWords(core, { live: true, fetchFn: again as unknown as typeof fetch, cache });
    expect(again).not.toHaveBeenCalled();
    expect(r.calls).toBe(0);
  });

  it('falls back to offline WordNet data when Datamuse fails, and in mock mode (FR-GEN-018)', async () => {
    const down = vi.fn(async () => {
      throw new Error('timeout');
    });
    const live = await relatedWords(core, { live: true, fetchFn: down as unknown as typeof fetch });
    const offline = await relatedWords(core, { live: false });
    expect(live.expansions.length).toBeGreaterThan(0);
    expect(offline.expansions.every((e) => e.source === 'wordnet')).toBe(true);
    expect(offline.calls).toBe(0);
  });

  it('drops sad or alarming related words ("care" → "pity") but keeps useful ones', async () => {
    const health = weighTerms(extractTerms('Health marketplace connecting patients with care providers'));
    const offline = await relatedWords(health, { live: false });
    const words = offline.expansions.map((e) => e.word);
    expect(words).not.toContain('pity');
    expect(words).not.toContain('sufferer');
    expect(words).toContain('aid');
    const live = await relatedWords(health, {
      live: true,
      fetchFn: datamuse(['grief', 'clinic']) as unknown as typeof fetch,
    });
    expect(live.expansions.map((e) => e.word)).not.toContain('grief');
  });

  it('builds w000 options and keeps the 40 best by Jev or by relatedness', () => {
    const ex = Array.from({ length: 50 }, (_, i) => ({
      word: `w${i}`,
      score: 1 - i / 100,
      from: 'x',
      source: 'wordnet' as const,
    }));
    expect(Object.keys(expansionOptions(ex))[0]).toBe('w000');
    expect(keepExpansions(ex)).toHaveLength(40);
    expect(keepExpansions(ex, { w049: 0.9 })[0]!.word).toBe('w49');
  });
});
