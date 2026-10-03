// Spec 004 tech §11 `strategies/*.test.ts` (FR-GEN-004, FR-GEN-005): every style produces tagged candidates.
import { describe, expect, it } from 'vitest';
import { seededRng } from '../../src/generation/rng';
import { generateCandidates, STRATEGY_CAPS } from '../../src/generation/strategies';
import { INPUT } from './input';

describe('naming styles', () => {
  const out = generateCandidates(INPUT, seededRng('seed'));
  const styles = new Set(out.map((c) => c.strategy));

  it('uses the required styles and tags each candidate with its style and source words', () => {
    for (const s of [
      'exact',
      'compound',
      'affix',
      'blend',
      'short',
      'alliteration',
      'brandable',
      'hack',
      'geo',
      'action',
      'personal',
    ]) {
      expect(styles, s).toContain(s);
    }
    for (const c of out) expect(c.sourceTerms.length).toBeGreaterThan(0);
  });

  it('respects each style cap and the maximum length', () => {
    for (const [s, cap] of Object.entries(STRATEGY_CAPS))
      expect(out.filter((c) => c.strategy === s).length).toBeLessThanOrEqual(cap);
    for (const c of out) expect(c.label.length).toBeLessThanOrEqual(15);
  });

  it('builds sensible examples', () => {
    const labels = new Set(out.map((c) => c.label));
    expect(labels).toContain('sourdoughbread'); // exact phrase
    expect(labels).toContain('breadcake'); // compound
    expect(labels).toContain('getbread'); // affix
    expect(labels).toContain('orderbread'); // action
    expect(labels).toContain('priyabread'); // personal
  });

  it('never clips a word into other words ("healthcare" → "healthcar")', () => {
    const input = { ...INPUT, words: [{ word: 'healthcare', weight: 0.6, core: true }, ...INPUT.words] };
    const shorts = generateCandidates(input, seededRng('seed')).filter((c) => c.strategy === 'short');
    expect(shorts.length).toBeGreaterThan(0);
    expect(shorts.map((c) => c.label)).not.toContain('healthcar');
  });

  it('only accepts pronounceable invented words for the brandable style', () => {
    const brandables = out.filter((c) => c.strategy === 'brandable').map((c) => c.label);
    expect(brandables.length).toBeGreaterThan(20);
    for (const b of brandables) expect(b).toMatch(/^[a-z]{4,15}$/);
  });
});
